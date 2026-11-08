import {DocumentHandle,bytesToBase64,type EngineHost} from '@nitro-forge/ignition';
export type MotionProperty='tx'|'ty'|'sx'|'sy'|'rotation'|'ox'|'oy'|'opacity'|'path_progress'|'rx'|'ry'|'z';
/** A motion-path node mirroring Prism's node wire shape: `x`/`y` anchor plus optional cubic handles as offsets from the node (`in` leads into the node, `out` leaves toward the next). A segment with neither handle is a straight line. */
export interface MotionPathNode{x:number;y:number;in?:[number,number];out?:[number,number]}
/** A single-subpath motion path in the layer's transform space (1..=256 nodes, coordinates/handles bounded). `closed` connects last node to first; `auto_orient` adds the path tangent angle in degrees to evaluated rotation. Progress is arc-length fraction via the `path_progress` property (0..=1). */
export interface MotionPath{nodes:MotionPathNode[];closed?:boolean;auto_orient?:boolean}
export interface CurvePoint{time:number;value:number}
export interface MotionKey extends CurvePoint{id:number;interpolation:'hold'|'linear'|'bezier';in_handle:CurvePoint|null;out_handle:CurvePoint|null}
export type MotionKeyInput=Omit<MotionKey,'id'>&{id?:number};
export interface Transform{tx:number;ty:number;sx:number;sy:number;rotation:number;ox:number;oy:number}
/** Optional per-layer 3D orientation/depth (engine slice G1). `rx`/`ry` are X/Y euler rotations in degrees about the layer's anchor; `z` is depth along the view axis (positive toward the viewer). `rotation` remains the Z-axis roll and `tx`/`ty`/`sx`/`sy`/`ox`/`oy` are unchanged. Presence marks the layer 3D-enabled and is required by `rx`/`ry`/`z` curves; all fields are bounded |.|<=1e7, not angle-wrapped. Storage/eval only: `renderFrame` ignores it until G2 projection rendering. */
export interface Transform3D{rx:number;ry:number;z:number}
/** Read-only `evaluate` output on layers carrying `transform3d`: the orthographic projection (view axis = layer-local Z, depth dropped) of the evaluated local transform as a 2x3 affine, `x'=a*x+c*y+e`, `y'=b*x+d*y+f`. May carry shear the 2D `Transform` fields cannot express; `z` does not affect it and parent composition stays local-only. Never stored, never in `describe`/snapshots, never affects `renderFrame`. */
export interface ProjectedTransform2D{a:number;b:number;c:number;d:number;e:number;f:number}
export interface Shape{kind:'rect'|'ellipse';x:number;y:number;w:number;h:number;fill:[number,number,number,number]}
export type LayerKind='shape'|'raster'|'comp'|'particles'|'media';
/** The 13 W3C Compositing Level 1 blend modes Prism implements; `null`/`"normal"` is the default source-over. */
export type MotionBlendMode='normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'|'add';
/** Track-matte modes: alpha/luma read the matte source's rendered subtree; inverted modes complement the derived mask. */
export type MotionMatteMode='alpha'|'alpha-inverted'|'luma'|'luma-inverted';
/** A stored matte as reported by describe/evaluate; `feather` is bounded 0..=64 and `enabled:false` stores without masking. */
export interface MotionMatte{source_layer:number;mode:MotionMatteMode;feather:number;enabled:boolean}
/** setLayerMatte input: feather defaults to 0 and enabled defaults to true. */
export interface MotionMatteInput{source_layer:number;mode:MotionMatteMode;feather?:number;enabled?:boolean}
/** Bounded CPU effect stack entries (engine slice C). Wire `kind` is kebab-case; params are validated engine-side. `brightness.amount` is -1..=1, `contrast.amount` a 0..=4 linear-light factor, `gaussian-blur.radius_px` 0..=64, `fill` takes an RGBA `color` plus optional `opacity` 0..=1 (default 1). At most 16 effects per layer. */
export type MotionEffect=
 |{kind:'invert'}
 |{kind:'grayscale'}
 |{kind:'brightness';amount:number}
 |{kind:'contrast';amount:number}
 |{kind:'gaussian-blur';radius_px:number}
 |{kind:'fill';color:[number,number,number,number];opacity?:number};
/** What each particle draws: a bounded axis-aligned shape (`rect`|`ellipse`, width/height in layer-local units before transform scale, 0<w,h<=512) or an existing raster `asset_id` stamped at natural size. */
export type MotionSprite=
 |{kind:'shape';shape:'rect'|'ellipse';width:number;height:number;fill:[number,number,number,number]}
 |{kind:'asset';asset_id:number};
/** Deterministic particle emitter on a `particles` layer (engine slice F). Particle `n` is born at `n/rate` seconds and lives `lifetime_s`; position is closed-form `spawn + v*tau + 0.5*gravity*tau^2` with per-particle attributes hashed from `seed` — no sim state, so any `time_s` reproduces identically. Bounds: rate 0..=8192 with rate*lifetime_s<=511 (<=512 alive sprites/emitter/frame), lifetime<=3600, speed<=1e5, spread<=360, speed/size jitter 0..=1, grow -0.9..=8, fade 0..=0.5, sprite dims<=512, spawn rect coords |.|<=1e7. `spawn` omitted = containing composition canvas mapped into layer space. At most 64 emitters per document and 512 summed alive sprites per composition. */
export interface MotionEmitter{seed?:number;rate?:number;lifetime_s?:number;angle_deg?:number;spread_deg?:number;speed?:number;speed_jitter?:number;gravity?:[number,number];spawn?:{x:number;y:number;w:number;h:number};sprite:MotionSprite;size_jitter?:number;grow?:number;fade?:number}
/** A stored bounded scalar expression on one layer property (engine slice D). `source` is the UTF-8 expression text (≤4096 bytes, ≤512 AST nodes, ≤64 calls); it is mutually exclusive with that property's curve — the last write wins and clears the other atomically. Grammar: arithmetic/comparison/ternary plus whitelisted pure functions and `time`/`frame`/`fps`/`duration`/`this.<prop>`/`layer(<id>).<prop>` (same-composition) references. Evaluation is a pure function of the explicit time — non-finite results resolve to 0 and finite results clamp to the property bounds. */
export interface MotionExpression{property:MotionProperty;source:string}
/** Closed scalar node-kind enum (engine slice I): six sources (`const`,`time`,`frame`,`fps`,`duration`,`property`), unary math (`neg`,`not`,`abs`,`floor`,`ceil`,`round`,`trunc`,`sign`,`sqrt`,`cbrt`,`exp`,`ln`,`log10`,`sin`,`cos`,`tan`,`asin`,`acos`,`atan`), binary math/logic/comparison (`add`,`sub`,`mul`,`div`,`mod`,`min`,`max`,`pow`,`atan2`,`hypot`,`and`,`or`,`eq`,`neq`,`lt`,`lte`,`gt`,`gte`) and three-pin `clamp`,`lerp`,`smoothstep`,`select`. Every node has one f64 `out`; inputs are a fixed per-kind pin set. */
export type MotionGraphNodeKind='const'|'time'|'frame'|'fps'|'duration'|'property'|'neg'|'not'|'abs'|'floor'|'ceil'|'round'|'trunc'|'sign'|'sqrt'|'cbrt'|'exp'|'ln'|'log10'|'sin'|'cos'|'tan'|'asin'|'acos'|'atan'|'add'|'sub'|'mul'|'div'|'mod'|'min'|'max'|'pow'|'atan2'|'hypot'|'and'|'or'|'eq'|'neq'|'lt'|'lte'|'gt'|'gte'|'clamp'|'lerp'|'smoothstep'|'select';
/** One graph input pin: an edge to another node's `out` or a const literal. */
export type MotionGraphEdge={node:number}|{const:number};
/** Per-kind non-input constants: `const` nodes carry `value` (finite, |.|<=1e7); `property` nodes carry `layer`+`property` and read that layer's PRE-BINDING curve/base value (expressions and graph bindings are never observed, keeping the graph acyclic). Absent on every other kind. */
export interface MotionGraphNodeParams{value?:number;layer?:number;property?:MotionProperty}
/** A graph node: unique positive id below `next_node_id`, closed `kind`, exact per-kind `inputs` pin map. Caps: ≤512 nodes, ≤2048 edges, ≤128 bindings, acyclic (Kahn topo, ascending-id ties). */
export interface MotionGraphNode{id:number;kind:MotionGraphNodeKind;params?:MotionGraphNodeParams;inputs:Record<string,MotionGraphEdge>}
/** Attaches a node's `out` to a `(layer,property)` cell — mutually exclusive with that property's curve and expression (last write wins, atomic clear). ≤128 bindings; the bound layer must exist and satisfy the same kind gates as curves. */
export interface MotionGraphBinding{layer:number;property:MotionProperty;node:number}
/** The document-global value graph (engine slice I): scalar f64 DAG plus bindings. `time`/`frame`/`fps`/`duration` sources evaluate per consuming composition's local time; `evaluate`/`renderFrame` remain pure functions of `t`. */
export interface MotionGraph{nodes:MotionGraphNode[];bindings:MotionGraphBinding[];next_node_id:number}
/** setGraph input: full replacement of nodes and bindings; `null` clears. Node ids are client-chosen positive safe integers (describe exposes `next_node_id`); the engine advances the counter past the largest id. */
export interface MotionGraphInput{nodes?:MotionGraphNode[];bindings?:MotionGraphBinding[]}
export interface MotionLayerMedia{source_id:string;in_point?:number}
interface MotionLayerCommon{id:number;name:string;visible:boolean;locked:boolean;kind:LayerKind;transform:Transform;opacity:number;curves:{property:MotionProperty;keys:MotionKey[]}[];parent_id?:number;blend?:MotionBlendMode;clipped?:boolean;matte?:MotionMatte;effects?:MotionEffect[];path?:MotionPath;path_progress?:number;emitter?:MotionEmitter;transform3d?:Transform3D;expressions?:MotionExpression[];media?:MotionLayerMedia;projected_transform?:ProjectedTransform2D}
/** Exactly one real content source; no placeholder shape for raster or comp layers. `comp` is the composition id a comp layer instantiates (0 is never a valid target). Particles layers carry only the optional `emitter` spec; media layers carry only the optional `media` reference (storage only, renders transparent). */
export type MotionLayer=MotionLayerCommon&({shape:Shape;asset_id?:never;comp_id?:never;emitter?:never;media?:never}|{asset_id:number;shape?:never;comp_id?:never;emitter?:never;media?:never}|{comp_id:number;shape?:never;asset_id?:never;emitter?:never;media?:never}|{emitter?:MotionEmitter;shape?:never;asset_id?:never;comp_id?:never;media?:never}|{media?:MotionLayerMedia;shape?:never;asset_id?:never;comp_id?:never;emitter?:never});

export const MOTION_RASTER_FORMAT='rgba8-straight-srgb' as const;
export interface MotionRasterAsset{readonly id:number;readonly width:number;readonly height:number;readonly format:typeof MOTION_RASTER_FORMAT;readonly pixels_b64:string}
export interface CompositionSettings{title:string;width:number;height:number;duration_s:number;frame_rate:{num:number;den:number}}
/** A nested composition; the root composition is the document header (title/width/height/duration_s/frame_rate) plus `layers`. */
export interface MotionComposition{id:number;name:string;width:number;height:number;duration_s:number;frame_rate:{num:number;den:number};layers:MotionLayer[]}
/** describe always materializes assets:{}, compositions:{}, render_queue:[] and every next_* counter, including legacy shape snapshots. */
export interface MotionState extends CompositionSettings{kind:'motion';schema:1|2;next_layer_id:number;next_key_id:number;layers:MotionLayer[];compositions:Readonly<Record<string,MotionComposition>>;next_comp_id:number;assets:Readonly<Record<string,MotionRasterAsset>>;next_asset_id:number;graph?:MotionGraph;render_queue:RenderJob[];next_job_id:number}
export interface MotionEvaluation{layers:MotionLayer[];compositions:Readonly<Record<string,MotionComposition>>}
/** Durable render-queue job status (engine slice J1). Synchronous stepping means a job is never persistently "rendering": pending = frames remain, done = all frames stepped, cancelled = dropped from the pending order with progress retained. */
export type RenderJobStatus='pending'|'done'|'cancelled';
/** One durable render job: inclusive 0-based frame range rendered at the target composition's own frame rate (`comp_id` absent = root; a nested id renders that composition standalone). `frames_done` counts frames already returned by `renderQueueFrame`; `frames_done === to_frame-from_frame+1` exactly when `status==='done'`. */
export interface RenderJob{id:number;name?:string;comp_id?:number;from_frame:number;to_frame:number;status:RenderJobStatus;frames_done:number}
/** Real queue counters reported by `renderQueueFrame` — exact frame/job counts, never percentages or estimates. */
export interface RenderQueueSummary{jobs:number;pending:number;done:number;cancelled:number;pending_frames:number}
/** Result of one `renderQueueFrame` step: the raw RGBA frame (same `pixels_b64`/binary-output contract as `renderFrame`) plus exact progress. No encoding or export is implied — J2 remains blocked on an encoder provider. */
export interface RenderQueueStep{job_id:number;name?:string;comp_id?:number;frame:number;from_frame:number;to_frame:number;frames_done:number;frames_total:number;status:RenderJobStatus;width:number;height:number;pixels_b64?:string;queue:RenderQueueSummary}
export class MotionDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,settings:Partial<CompositionSettings>={}){return new MotionDocument(await DocumentHandle.openInitialized(host,'motion',doc=>doc.apply('new',settings)));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new MotionDocument(await DocumentHandle.openSnapshot(host,'motion',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<MotionState>('describe',{});}
 setComposition(patch:Partial<CompositionSettings>){return this.document.apply<{ok:boolean}>('setComposition',patch);}
 /** Immediate bounded subview copy/encoding before any await; the engine never borrows caller bytes. */
 addRasterAsset(width:number,height:number,pixels:Uint8Array){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||width*height>1048576||pixels.byteLength!==width*height*4)throw new RangeError('RGBA asset dimensions/length exceed the one-megapixel budget');
  const pixels_b64=bytesToBase64(Uint8Array.from(pixels));
  return this.document.apply<{asset_id:number}>('addRasterAsset',{width,height,format:MOTION_RASTER_FORMAT,pixels_b64});
 }
 readRasterAsset(id:number){return this.document.apply<MotionRasterAsset>('readRasterAsset',{id});}
 removeRasterAsset(id:number){return this.document.apply<{ok:boolean}>('removeRasterAsset',{id});}
 /** `comp` optionally targets a nested composition; omitted or 0 selects the root. */
 addRasterLayer(asset_id:number,name?:string,comp?:number){return this.document.apply<{layer_id:number}>('addRasterLayer',{asset_id,...(name===undefined?{}:{name}),...(comp===undefined?{}:{comp})});}
 addShapeLayer(shape:Shape,name?:string,comp?:number){return this.document.apply<{layer_id:number}>('addShapeLayer',{shape,...(name===undefined?{}:{name}),...(comp===undefined?{}:{comp})});}
 /** Create a nested composition; width/height/duration default to 640x360/root duration, frame rate inherits the root. */
 addComposition(patch:{name?:string;width?:number;height?:number;duration_s?:number}={}){return this.document.apply<{comp_id:number}>('addComposition',patch);}
 duplicateComposition(id:number){return this.document.apply<{comp_id:number}>('duplicateComposition',{id});}
 /** Instance a composition as a layer; `into` optionally selects the containing composition (0/root default). */
 addCompLayer(comp:number,name?:string,into?:number){return this.document.apply<{layer_id:number}>('addCompLayer',{comp,...(name===undefined?{}:{name}),...(into===undefined?{}:{into})});}
 removeComposition(id:number){return this.document.apply<{ok:boolean}>('removeComposition',{id});}
 /** Transform parenting within one composition; null clears. Parent and child must share a composition. */
 setLayerParent(layer:number,parent:number|null){return this.document.apply<{ok:boolean}>('setLayerParent',{layer,parent});}
 /** W3C blend mode against the layers below in the same composition; null or "normal" clears to source-over. */
 setLayerBlend(layer:number,blend:MotionBlendMode|null){return this.document.apply<{ok:boolean}>('setLayerBlend',{layer,blend});}
 /** Clip this layer to the alpha of the nearest unclipped sibling below it in the same composition; the bottom layer of a composition cannot be clipped. */
 setLayerClipped(layer:number,clipped:boolean){return this.document.apply<{ok:boolean}>('setLayerClipped',{layer,clipped});}
 /** Track matte: mask this layer's own alpha with another layer's rendered subtree in the same composition; null clears. */
 setLayerMatte(layer:number,matte:MotionMatteInput|null){return this.document.apply<{ok:boolean}>('setLayerMatte',{layer,matte});}
 /** Replace the layer's effect stack (full replace, at most 16); null or [] clears. Effects run on the layer's rendered pixels after its transform and before opacity/blend/clip/matte. */
 setLayerEffects(layer:number,effects:readonly MotionEffect[]|null){return this.document.apply<{ok:boolean}>('setLayerEffects',{layer,effects});}
 /** Create a deterministic particle-emitter layer (empty until `setParticleEmitter`); `comp` optionally targets a nested composition. */
 addParticlesLayer(name?:string,comp?:number){return this.document.apply<{layer_id:number}>('addParticlesLayer',{...(name===undefined?{}:{name}),...(comp===undefined?{}:{comp})});}
 /** Attach/replace/clear the layer's particle emitter; null clears to an empty particles layer. Requires a `particles` kind layer. Full-spec replace, validated engine-side. */
 setParticleEmitter(layer:number,emitter:MotionEmitter|null){return this.document.apply<{ok:boolean}>('setParticleEmitter',{layer,emitter});}
 /** Move a layer to another composition at `index`; comp 0 selects the root. Cross-comp moves clear transform-parent links. */
 reparentLayer(layer:number,comp:number,index:number){return this.document.apply<{ok:boolean}>('reparentLayer',{layer,comp,index});}
 /** Attach/replace/clear the layer's motion path; null clears the path, its progress base and any `path_progress` curve atomically. Animate position along it with `setPropertyKeys(layer,'path_progress',...)` keys in 0..=1; the sampled offset adds to tx/ty and `auto_orient` adds the tangent angle to rotation. */
 setMotionPath(layer:number,path:MotionPath|null){return this.document.apply<{ok:boolean}>('setMotionPath',{layer,path});}
 /** Attach/replace/clear the layer's 3D transform; null clears `transform3d` and any `rx`/`ry`/`z` curves atomically. Absent fields default to 0 (identity). `rx`/`ry`/`z` are also `MotionProperty` curve names once transform3d is set. Storage/eval only — renderFrame ignores 3D until G2; `evaluate` adds `projected_transform` (orthographic 2x3 affine) to 3D layers. */
 setLayer3D(layer:number,transform3d:Transform3D|null){return this.document.apply<{ok:boolean}>('setLayer3D',{layer,transform3d});}
 /** Create a media/footage layer referencing an opaque host `source_id` (slice H-schema). `media` may be omitted/null for an empty media layer until `setLayerMedia` attaches a spec; `comp` optionally targets a nested composition. Storage only — the engine never resolves `source_id` and the layer renders fully transparent until the P03 transport contract lands. */
 addMediaLayer(media:MotionLayerMedia|null,name?:string,comp?:number){return this.document.apply<{layer_id:number}>('addMediaLayer',{...(media===null?{}:{media}),...(name===undefined?{}:{name}),...(comp===undefined?{}:{comp})});}
 /** Attach/replace/clear the media layer's `{source_id,in_point}` reference; null clears to an empty media layer. Requires a `media` kind layer; full-spec replace, validated engine-side. */
 setLayerMedia(layer:number,media:MotionLayerMedia|null){return this.document.apply<{ok:boolean}>('setLayerMedia',{layer,media});}
 updateLayer(id:number,patch:Partial<Pick<MotionLayer,'name'|'visible'|'locked'|'opacity'|'shape'|'asset_id'>>&{transform?:Partial<Transform>}){return this.document.apply<{ok:boolean}>('updateLayer',{...patch,id});}
 removeLayer(id:number){return this.document.apply<{ok:boolean}>('removeLayer',{id});}
 setLayerOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setLayerOrder',{order});}
 setPropertyKeys(layer:number,property:MotionProperty,keys:readonly MotionKeyInput[]){return this.document.apply<{key_ids:number[]}>('setPropertyKeys',{layer,property,keys});}
 /** Attach/replace/clear a bounded scalar expression on one layer property; null clears. Mutually exclusive with that property's curve — setting an expression deletes its keys and setPropertyKeys deletes the expression, atomically in one journal entry. Expression and `layer()` references must keep the document's dependency graph acyclic; `layer(<id>)` reads same-composition layers only. */
 setExpression(layer:number,property:MotionProperty,source:string|null){return this.document.apply<{ok:boolean}>('setExpression',{layer,property,source});}
 /** Full-replace the document-global scalar value graph (engine slice I): `nodes` (≤512, closed f64 kinds, exact per-kind input pins, acyclic) plus `bindings` (≤128, `{layer,property,node}` attaching a node's `out` to a layer property). `null` clears. Mutually exclusive with curves/expressions on bound cells — conflicting sources clear atomically in the same journal entry; locked layers reject. `time`/`frame`/`fps`/`duration` sources evaluate per consuming composition's local time; `property` sources read pre-binding values. Values sanitize at the property boundary like expressions. */
 setGraph(graph:MotionGraphInput|null){return this.document.apply<{ok:boolean}>('setGraph',graph);}
 /** Root layers plus each composition evaluated at its duration-scaled local time; curves are cleared in output and 3D layers carry `projected_transform`. */
 evaluate(time_s:number){return this.document.apply<MotionEvaluation>('evaluate',{time_s});}
 /** One real bounded RGBA frame; no encoding, file delivery or render queue. */
 renderFrame(time_s:number){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',{time_s});}
 /** Enqueue a durable render job: inclusive 0-based `from_frame`..`to_frame` at the target composition's frame rate (`comp` omitted/0 = root). At most 256 jobs, 4096 frames/job and 16384 frames total; pending jobs must fit the composition's current duration. */
 addRenderJob(patch:{name?:string;comp?:number;from_frame:number;to_frame:number}){return this.document.apply<{job_id:number}>('addRenderJob',patch);}
 /** Exact permutation of all job ids (pending, done and cancelled) — same contract as `setLayerOrder`. */
 setRenderQueueOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setRenderQueueOrder',{order});}
 /** Pending → cancelled; progress so far is retained and the job stays listed until removed. Done/cancelled jobs reject. */
 cancelRenderJob(job:number){return this.document.apply<{ok:boolean}>('cancelRenderJob',{job});}
 /** Remove a job from the queue entirely, regardless of status. */
 removeRenderJob(job:number){return this.document.apply<{ok:boolean}>('removeRenderJob',{job});}
 /** Step the queue by one real frame: renders the next frame of `job` (or the first pending job) through the same path as `renderFrame` and returns raw RGBA plus exact progress. Mutating and undoable; emits `document:changed`. No encoding — J2 stays blocked. */
 renderQueueFrame(job?:number){return this.document.apply<RenderQueueStep>('renderQueueFrame',job===undefined?{}:{job});}
 save(){return this.document.snapshot();} undo(){return this.document.undo();} redo(){return this.document.redo();} close(){return this.document.close();}
}
