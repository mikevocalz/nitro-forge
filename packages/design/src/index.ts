import {DocumentHandle,type CommandResult,type EngineHost} from '@nitro-forge/ignition';
/** Op names — mirrors docs/ENGINE_OPS.md § design-engine. */
export const OPS={
 new:'new',
 describe:'describe',
 setComposition:'setComposition',
 addFrame:'addFrame',
 addShape:'addShape',
 addText:'addText',
 updateNode:'updateNode',
 setAxisSizing:'setAxisSizing',
 readAxisSizing:'readAxisSizing',
 setFrameLayout:'setFrameLayout',
 setChildOrder:'setChildOrder',
 reparentNode:'reparentNode',
 removeNode:'removeNode',
 defineMode:'defineMode',
 renameMode:'renameMode',
 removeMode:'removeMode',
 defineVariable:'defineVariable',
 setVariableValue:'setVariableValue',
 removeVariable:'removeVariable',
 setActiveMode:'setActiveMode',
 describeVariables:'describeVariables',
 bindVariable:'bindVariable',
 unbindVariable:'unbindVariable',
 listBindings:'listBindings',
 setConstraints:'setConstraints',
 readConstraints:'readConstraints',
 createComponent:'createComponent',
 updateComponent:'updateComponent',
 createInstance:'createInstance',
 updateInstance:'updateInstance',
 detachInstance:'detachInstance',
 describeComponents:'describeComponents',
 definePrototypeScreen:'definePrototypeScreen',
 updatePrototypeScreen:'updatePrototypeScreen',
 removePrototypeScreen:'removePrototypeScreen',
 definePrototypeHotspot:'definePrototypeHotspot',
 updatePrototypeHotspot:'updatePrototypeHotspot',
 removePrototypeHotspot:'removePrototypeHotspot',
 definePrototypeTransition:'definePrototypeTransition',
 updatePrototypeTransition:'updatePrototypeTransition',
 removePrototypeTransition:'removePrototypeTransition',
 definePrototypeInteraction:'definePrototypeInteraction',
 updatePrototypeInteraction:'updatePrototypeInteraction',
 removePrototypeInteraction:'removePrototypeInteraction',
 prototypeGraph:'prototypeGraph',
 resolvePrototypeEvent:'resolvePrototypeEvent',
 evaluateLayout:'evaluateLayout',
 renderFrame:'renderFrame',
 describeHandoff:'describeHandoff',
 exportSlice:'exportSlice',
} as const;
export type SizeMode='fixed'|'hug'|'fill';
export type Axis='x'|'y';
export interface AxisSizing {mode:SizeMode;value:number;fixedValue:number;resolvedValue:number;canHug:boolean;canFill:boolean;unavailableReason?:string;hugReason?:string;fillReason?:string}
export type AxisSizingUpdate={mode:'fixed';value?:number}|{mode:'hug'|'fill'};
export type SizingSettings={x:SizeMode;y:SizeMode};
export type NodeKind='frame'|'rect'|'ellipse'|'text'|'component'|'instance';
/** Bounded override surface for instances and component variants. `text`
 * sets only the content string of a text target; font style stays authored.
 * `node` is the template node id — the component root id targets the
 * expanded instance root. */
export type OverridePath='name'|'fill'|'x'|'y'|'width'|'height'|'visible'|'locked'|'text';
export type OverrideValue=boolean|number|string|[number,number,number,number];
export interface NodeOverride{node:number;path:OverridePath;value:OverrideValue}
/** Named override bundle on a component; `updateInstance` selects one by
 * name. Multi-axis variant properties are deferred. */
export interface ComponentVariant{name:string;properties?:NodeOverride[]}
/** Instance payload on `kind:'instance'` nodes: component reference,
 * optional variant name, and per-target overrides applied after variant
 * properties (instance values win on node+path conflicts). */
export interface InstanceSpec{component:number;variant?:string;overrides?:NodeOverride[]}
export type TextFontStyle='normal'|'italic';
/** Bounded text style; content ≤64KiB UTF-8, font_family ≤256 bytes, font_size>0≤1e4, font_weight 1..=1000. */
export interface TextStyle{content:string;font_family:string;font_size:number;font_weight:number;font_style:TextFontStyle}
/** Partial font patch accepted by addText `style`; content is top-level there. */
export type FontStylePatch=Partial<Omit<TextStyle,'content'>>;
/** Partial text patch accepted by updateNode `text`, content included. `null`
 * is reserved and always rejected: a text node cannot exist without a style. */
export type TextStylePatch=FontStylePatch & {content?:string};
export type VariableType='number'|'string'|'boolean';
/** Per-mode variable value mirroring NYC-Tron `DesignVariableValue`;
 * engine serialization is snake_case (`variable_id`). */
export type VariableValue={kind:'number';value:number}|{kind:'string';value:string}|{kind:'boolean';value:boolean}|{kind:'alias';variable_id:string};
export interface DesignVariable{id:string;name:string;type:VariableType;values:Record<string,VariableValue>}
export interface DesignMode{id:string;name:string}
/** Closed set of bindable numeric node properties. */
export type BindPath='fill_r'|'fill_g'|'fill_b'|'fill_a'|'gap'|'padding_top'|'padding_right'|'padding_bottom'|'padding_left'|'x'|'y'|'width'|'height';
export interface VariableBinding{node_id:number;path:BindPath;variable_id:string}
export interface VariableBindingInfo extends VariableBinding{resolved:number|null}
export interface VariableInfo extends DesignVariable{resolved:Record<string,VariableValue>;problems:string[]}
export interface VariablesDescription{modes:DesignMode[];active_mode:string|null;variables:VariableInfo[];bindings:VariableBindingInfo[]}
/** NYC-Tron `DesignConstraints` h/v anchor axes. `scale` parses but the
 * engine rejects it until the constraint solver slice; the engine's accepted
 * set is left/right/center/stretch (horizontal) and top/bottom/center/stretch
 * (vertical), where `stretch` is the Figma-style both-edges anchor. */
export type HorizontalAnchor='left'|'right'|'center'|'stretch'|'scale';
export type VerticalAnchor='top'|'bottom'|'center'|'stretch'|'scale';
/** Stored responsive constraints on absolute children only — the NYC-Tron
 * `DesignConstraints` contract in snake_case engine fields. C1 admitted the
 * h/v anchors; C2 adds optional per-axis extent bounds (`min_*`/`max_*`,
 * finite, 0..=1e7, min<=max when both present), the `aspect_locked` flag
 * (NYC-Tron `aspectLocked`; no ratio is stored — a solver derives it from
 * geometry at enforcement time) and `relative_to` targets naming the parent
 * frame or a sibling; absent means the parent. `scale` anchors reject until
 * the solver slice. Everything is durable storage only: evaluateLayout does
 * not solve constraints and `enforced` stays false. */
export interface NodeConstraints{horizontal:HorizontalAnchor;vertical:VerticalAnchor;min_width?:number;max_width?:number;min_height?:number;max_height?:number;aspect_locked?:boolean;relative_to?:number}
export interface ConstraintNodeInfo{node_id:number;constraints:NodeConstraints;enforced:boolean}
export interface ConstraintsDescription{solving:'storage-only';accepted:{horizontal:HorizontalAnchor[];vertical:VerticalAnchor[];relative_to:('parent'|'sibling')[];extent_bounds:string};rejected:string[];nodes:ConstraintNodeInfo[]}
/** NYC-Tron `PrototypeInteraction.trigger` set (InteractionTriggerEditor). */
export type PrototypeTrigger='tap'|'press'|'hover'|'drag'|'timer';
/** NYC-Tron `PrototypeInteraction.action` set. */
export type PrototypeAction='navigate'|'overlay'|'back'|'close-overlay'|'set-variable';
/** Bounded transition kinds; `slide` requires `direction`. */
export type TransitionKind='instant'|'dissolve'|'slide'|'smart-animate';
export type TransitionEasing='linear'|'ease-in'|'ease-out'|'ease-in-out';
export type SlideDirection='left'|'right'|'up'|'down';
/** What an interaction acts on: a registered screen node for
 * navigate/overlay, a design variable for set-variable; back/close-overlay
 * carry no target. Engine serialization is `{kind:'screen',node}` /
 * `{kind:'variable',id}` — the typed mapping of the NYC-Tron string
 * `destinationId` contract. */
export type PrototypeTarget={kind:'screen';node:number}|{kind:'variable';id:string};
/** A screen catalog entry: a durable reference to a frame/component node
 * plus the FlowOverview entry flag. The label is derived live from the
 * node name at read time. */
export interface PrototypeScreen{node:number;entry?:boolean}
/** A trigger region normalized to 0..=1 inside its screen's box; the
 * region must stay inside the unit square. */
export interface PrototypeHotspot{id:string;screen:number;label:string;x:number;y:number;width:number;height:number}
export interface PrototypeTransition{id:string;label:string;kind:TransitionKind;easing?:TransitionEasing;direction?:SlideDirection;duration_ms?:number}
/** NYC-Tron `PrototypeInteraction` as durable state, attached to exactly
 * one of `hotspot` (id) or `screen` (node). `delay_ms` (≤86400000) is the
 * trigger delay the host schedules; `duration_ms` (≤600000) optionally
 * overrides the referenced transition's duration. `value` is an engine
 * extension: the literal a set-variable action writes, matching the target
 * variable's type (aliases are rejected). */
export interface PrototypeInteraction{id:string;hotspot?:string;screen?:number;trigger:PrototypeTrigger;delay_ms?:number;action:PrototypeAction;target?:PrototypeTarget;transition?:string;duration_ms?:number;value?:VariableValue}
export interface PrototypeScreenInfo{node:number;name:string;kind:NodeKind;entry:boolean;x:number;y:number;width:number;height:number}
export interface PrototypeHotspotInfo extends PrototypeHotspot{}
export interface PrototypeTransitionInfo{id:string;label:string;kind:TransitionKind;easing:TransitionEasing;direction?:SlideDirection;duration_ms:number}
export interface PrototypeInteractionInfo{id:string;hotspot?:string;screen?:number;trigger:PrototypeTrigger;delay_ms:number;action:PrototypeAction;target?:PrototypeTarget;transition?:string;duration_ms?:number;value?:VariableValue}
/** FlowOverview edge derived from navigate/overlay interactions. */
export interface PrototypeLink{id:string;source:number;target:number;label:PrototypeAction}
export interface PrototypeGraph{screens:PrototypeScreenInfo[];hotspots:PrototypeHotspotInfo[];interactions:PrototypeInteractionInfo[];transitions:PrototypeTransitionInfo[];links:PrototypeLink[];runtime:{clock:string;playback:string;note:string}}
/** Deterministic resolution of one event descriptor. `null` data means no
 * interaction matched. The engine stores no playback state and no clock:
 * `delay_ms`/`duration_ms` are returned for the host to schedule. */
export interface PrototypeEventResolution{matched:true;interaction:PrototypeInteractionInfo;transition:{id:string;kind:TransitionKind;easing:TransitionEasing;direction?:SlideDirection;duration_ms:number}|null;delay_ms:number;scheduled_by:'host'}
export type PrototypeEventQuery={hotspot?:string;screen?:number;trigger?:PrototypeTrigger};
/** Update patches: every field optional, explicit `null` clears the
 * optional members (hotspot/screen XOR, target, transition, duration_ms,
 * value on interactions; direction on transitions). */
export type PrototypeTransitionPatch=Partial<Omit<PrototypeTransition,'id'|'direction'>>&{direction?:SlideDirection|null};
export type PrototypeInteractionPatch={[K in keyof Omit<PrototypeInteraction,'id'>]?:Omit<PrototypeInteraction,'id'>[K]|null};
export interface FrameLayout{direction:'row'|'column';wrap?:boolean;gap:number;padding_top:number;padding_right:number;padding_bottom:number;padding_left:number;align:'start'|'center'|'end'|'stretch';justify:'start'|'center'|'end'|'space-between'}
export interface NodeGeometry{x:number;y:number;width:number;height:number}
export interface DesignNode extends NodeGeometry{id:number;kind:NodeKind;name:string;fill:[number,number,number,number];visible:boolean;locked:boolean;children:number[];layout:FrameLayout|null;sizing?:SizingSettings;text?:TextStyle;constraints?:NodeConstraints;variants?:ComponentVariant[];instance?:InstanceSpec}
export interface CompositionSettings{title:string;width:number;height:number}
/** describe/evaluateLayout expose the internal schema:1 state; the schema:2
 * wrapper `{kind:'design',schema:2,document}` exists only inside snapshot
 * bytes and only when schema-2 features (text nodes, node constraints,
 * variables/modes/bindings)
 * are present. The collections are omitted entirely when empty. */
/** Durable prototype catalog stored on the internal state; omitted when
 * empty. Any content triggers the schema:2 snapshot wrapper. */
export interface PrototypeCatalog{screens?:PrototypeScreen[];hotspots?:PrototypeHotspot[];interactions?:PrototypeInteraction[];transitions?:PrototypeTransition[]}
export interface DesignState{kind:'design';schema:1;title:string;next_id:number;nodes:Record<string,DesignNode>;variables?:Record<string,DesignVariable>;modes?:DesignMode[];active_mode?:string;bindings?:VariableBinding[];prototype?:PrototypeCatalog}
export type NodePatch=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'|'locked'>> & {text?:TextStylePatch};
export type NewNode=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'>>;
export interface NewTextNode extends NewNode{content:string;style?:FontStylePatch}
/** `id` is a real node id for stored nodes, or a synthetic expansion id
 * `>= 2^53-1` for instance clones. Synthetic ids are read-only provenance
 * handles: they exceed JS safe-integer precision, are never persisted, and
 * every op rejects them as unknown nodes — do not feed them back into ops. */
export interface EvaluatedBox extends NodeGeometry{id:number;kind:NodeKind;fill:[number,number,number,number];visible:boolean;renderable:boolean}
export interface ComponentDescription{id:number;name:string;variants:{name:string;properties:NodeOverride[]}[]}
export interface InstanceDescription{id:number;name:string;component:number|null;variant:string|null;overrides:NodeOverride[];unavailable_reason?:string}
export interface ComponentsDescription{expansion:{max_depth:number;max_nodes:number;persisted:boolean};components:ComponentDescription[];instances:InstanceDescription[]}
/** Bounded text projection inside handoff/export payloads: font fields in
 * full, `content` truncated at a UTF-8 boundary (256 bytes) with the exact
 * `content_bytes` length and `content_truncated` flag alongside. */
export interface TextStyleInfo{content:string;content_bytes:number;content_truncated:boolean;font_family:string;font_size:number;font_weight:number;font_style:TextFontStyle}
/** One node's handoff/manifest entry: evaluated geometry (`x`/`y` are
 * document units relative to the slice origin for export manifests,
 * absolute canvas units for describeHandoff), effective visibility and
 * renderability, plus presence-gated feature fields. `id`/`parent` may be
 * synthetic expansion ids `>= 2^53-1` inside export manifests — read-only
 * provenance, never op-addressable. */
export interface HandoffNodeInfo{id:number;parent:number|null;depth:number;kind:NodeKind;name:string;x:number;y:number;width:number;height:number;fill:[number,number,number,number];visible:boolean;renderable:boolean;sizing?:SizingSettings;layout?:FrameLayout|null;text?:TextStyleInfo;constraints?:NodeConstraints;instance?:{component:number;variant:string|null;overrides:number};variants?:number}
/** Prototype screen projected into the handoff payload with its live node
 * name/kind/entry flag and evaluated box when one exists. */
export interface HandoffScreenInfo{node:number;name:string;kind:NodeKind;entry:boolean;box?:NodeGeometry}
/** Deterministic structural hint per node — a "code hint" describing
 * stored state (kind, size, fill, font, layout), never generated source.
 * Every snippet carries the document `state_revision` it was computed
 * from so hosts can detect staleness. */
export interface HandoffSnippet{node:number;state_revision:number;hint:string}
/** `describeHandoff` (slice F, NYC-Tron L-12 storage scope): bounded
 * projection for dev handoff — spacing via evaluated layout measurements,
 * typography, assets (always empty: no image/asset nodes are admitted),
 * prototype screen membership and deterministic per-node hints tagged
 * with `state_revision`. Pure read: eventless, ungated, non-mutating.
 * Caps: measurements ≤8192 boxes (`measurements.truncated` beyond),
 * snippets ≤512 (`snippets_truncated` beyond); nodes/typography are
 * bounded by the stored-node budget. `deferred` lists honest gaps — no
 * PNG/SVG/vector encoder, no real code generation, no asset store. */
export interface HandoffDescription{state_revision:number;title:string;canvas:{node:number;width:number;height:number};units:'document';screens:HandoffScreenInfo[];nodes:HandoffNodeInfo[];measurements:{total:number;truncated:boolean;boxes:EvaluatedBox[]};typography:{node:number;name:string;box:NodeGeometry;text:TextStyleInfo}[];assets:never[];snippets:HandoffSnippet[];snippets_total:number;snippets_truncated:boolean;deferred:string[]}
/** `exportSlice` request: `node` must be a stored frame/component (every
 * registered prototype screen qualifies); `scale` is an optional bounded
 * multiplier in [0.25,4] defaulting to 1 — the engine must pick a pixel
 * size, while output format/presets stay host-side. */
export interface ExportSliceOptions{scale?:number}
/** Slice identity block: evaluated source box, pixel dimensions after
 * scale, and the raw RGBA8 format tag (no encoder exists). */
export interface ExportSliceInfo{node:number;name:string;kind:NodeKind;state_revision:number;box:NodeGeometry;origin:{x:number;y:number};scale:number;width:number;height:number;format:'rgba8'}
/** JSON manifest accompanying the RGBA pixels: per-node entries relative
 * to the slice origin (document units), capped at 4096 nodes with
 * `nodes_total`/`nodes_truncated` reporting the rest. The raster itself
 * is never truncated. */
export interface ExportManifest{node:number;name:string;kind:NodeKind;state_revision:number;pixel_format:'rgba8';origin:{x:number;y:number};scale:number;width:number;height:number;nodes_total:number;nodes_truncated:boolean;nodes:HandoffNodeInfo[];notes:string[]}
export interface ExportSliceResult{slice:ExportSliceInfo;manifest:ExportManifest;pixels_b64?:string}
/** Bounded fixed/hug/fill layout and real Prism RGBA plus variables/modes.
 * Text nodes are layout boxes only (renderable:false, fill background draws,
 * no glyphs); bindings resolve at read/render time and never bake into nodes.
 * Constraints are stored h/v anchors on absolute children only — storage and
 * validation, not solving (evaluateLayout ignores them in C1/C2). Components
 * and instances exist: instances expand deterministically at read/render
 * time only (never persisted expanded) under depth/node caps, with a bounded
 * override surface and named variant bundles. Instance sizing stays fixed.
 * The prototype catalog (slice E) stores screens/hotspots/interactions/
 * transitions as durable document state; `prototypeGraph` and
 * `resolvePrototypeEvent` are pure deterministic reads — the engine owns no
 * clock and never fakes animation playback (status/progress/delay
 * scheduling are host-owned). No images, clipping, groups or layers. */
export class DesignDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,settings:Partial<CompositionSettings>={}){return new DesignDocument(await DocumentHandle.openInitialized(host,'design',doc=>doc.apply(OPS.new,settings)));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new DesignDocument(await DocumentHandle.openSnapshot(host,'design',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<DesignState>(OPS.describe,{});}
 setComposition(patch:Partial<CompositionSettings>){return this.document.apply<{ok:boolean}>(OPS.setComposition,patch);}
 addFrame(parent:number,node:NewNode={}){return this.document.apply<{node_id:number}>(OPS.addFrame,{...node,parent});}
 addShape(parent:number,kind:'rect'|'ellipse',node:NewNode={}){return this.document.apply<{node_id:number}>(OPS.addShape,{...node,parent,kind});}
 /** parent defaults to the root canvas when omitted: `addText(node)` or `addText(parent,node)`. `style` carries font fields only; content is top-level. */
 addText(node:NewTextNode):Promise<CommandResult<{node_id:number}>>;
 addText(parent:number|undefined,node:NewTextNode):Promise<CommandResult<{node_id:number}>>;
 addText(parent:number|NewTextNode|undefined,node?:NewTextNode){const spec=(typeof parent==='object'?parent:node) as NewTextNode;const p=typeof parent==='number'?parent:undefined;const {content,style,...rest}=spec;return this.document.apply<{node_id:number}>(OPS.addText,{...rest,...(p===undefined?{}:{parent:p}),content,...(style?{style}:{})});}
 updateNode(id:number,patch:NodePatch){return this.document.apply<{ok:boolean}>(OPS.updateNode,{...patch,id});}
 /** Fixed without a value freezes evaluated size; explicit fixed values resize. Other modes retain authored fallback. */
 setAxisSizing(id:number,axis:Axis,update:AxisSizingUpdate){return this.document.apply<{ok:boolean}>(OPS.setAxisSizing,{id,axis,mode:update.mode,...(update.mode==='fixed'&&update.value!==undefined?{value:update.value}:{})});}
 readAxisSizing(id:number){return this.document.apply<{x:AxisSizing;y:AxisSizing}>(OPS.readAxisSizing,{id});}
 /** null restores absolute child positioning. */
 setFrameLayout(id:number,layout:FrameLayout|null){return this.document.apply<{ok:boolean}>(OPS.setFrameLayout,{id,layout});}
 setChildOrder(parent:number,order:readonly number[]){return this.document.apply<{ok:boolean}>(OPS.setChildOrder,{parent,order});}
 /** Preserves authored local coordinates; index is in the destination after removal. */
 reparentNode(id:number,parent:number,index:number){return this.document.apply<{ok:boolean}>(OPS.reparentNode,{id,parent,index});}
 removeNode(id:number){return this.document.apply<{ok:boolean}>(OPS.removeNode,{id});}
 /** id is optional: the engine assigns `mode-N`. At most 128 modes. */
 defineMode(mode:{id?:string;name:string}){return this.document.apply<{ok:boolean}>(OPS.defineMode,mode);}
 renameMode(id:string,name:string){return this.document.apply<{ok:boolean}>(OPS.renameMode,{id,name});}
 /** Removes the mode, strips its per-variable values, and moves active_mode to the first remaining mode (or none). */
 removeMode(id:string){return this.document.apply<{ok:boolean}>(OPS.removeMode,{id});}
 /** type is 'number'|'string'|'boolean'; values is an optional sparse
  * {mode:VariableValue} map. At most 1024 variables. */
 defineVariable(variable:{id?:string;name:string;type:VariableType;values?:Record<string,VariableValue>}){return this.document.apply<{ok:boolean}>(OPS.defineVariable,variable);}
 /** Sets one mode's value; aliases are validated server-side for cycles, type match and mode coverage. */
 setVariableValue(id:string,mode:string,value:VariableValue){return this.document.apply<{ok:boolean}>(OPS.setVariableValue,{id,mode,value});}
 /** Removes the variable and every binding that references it. */
 removeVariable(id:string){return this.document.apply<{ok:boolean}>(OPS.removeVariable,{id});}
 setActiveMode(id:string){return this.document.apply<{ok:boolean}>(OPS.setActiveMode,{id});}
 /** Read-only resolved values plus alias/coverage diagnostics; silent. */
 describeVariables(){return this.document.apply<VariablesDescription>(OPS.describeVariables,{});}
 /** Binds a numeric variable to a node property. width/height require fixed
  * sizing on that axis, x/y require absolute placement, gap/padding_* require
  * a frame, fill_* apply to any node. Only number variables bind. */
 bindVariable(node_id:number,path:BindPath,variable_id:string){return this.document.apply<{ok:boolean}>(OPS.bindVariable,{node_id,path,variable_id});}
 /** Removes the binding; unbinding an absent path is a silent no-op. */
 unbindVariable(node_id:number,path:BindPath){return this.document.apply<{ok:boolean}>(OPS.unbindVariable,{node_id,path});}
 /** Read-only binding list, optionally filtered to one node; silent. */
 listBindings(node_id?:number){return this.document.apply<{bindings:VariableBindingInfo[]}>(OPS.listBindings,node_id===undefined?{}:{node_id});}
 /** Stores h/v anchors plus optional C2 extent bounds, `aspect_locked` and a
  * parent-or-sibling `relative_to` on an absolute child — the parent must not
  * use flow layout and the node cannot be the root. `null` clears. `scale`
  * anchors, out-of-range or inverted min/max bounds and a `relative_to`
  * outside the parent/sibling scope reject with reasons; converting the
  * parent to flow layout, reparenting under one, or removing a `relative_to`
  * target rejects while constraints would be stranded. Constraints are
  * durable state only: evaluateLayout does not solve them. */
 setConstraints(id:number,constraints:NodeConstraints|null){return this.document.apply<{ok:boolean}>(OPS.setConstraints,{id,constraints});}
 /** Read-only constraint state plus the accepted/rejected anchor sets;
  * silent. `enforced` is always false until the solver slice lands. */
 readConstraints(id?:number){return this.document.apply<ConstraintsDescription>(OPS.readConstraints,id===undefined?{}:{id});}
 /** Converts an existing frame subtree into a reusable component
  * definition. Optional `variants` are named override bundles selectable
  * per instance; `name` renames in the same op. The root canvas cannot
  * become a component. */
 createComponent(id:number,options:{name?:string;variants?:ComponentVariant[]}={}){return this.document.apply<{ok:boolean}>(OPS.createComponent,{id,...options});}
 /** Renames a component and/or replaces its variant bundle list (empty
  * array clears). Requires an existing component node. */
 updateComponent(id:number,patch:{name?:string;variants?:ComponentVariant[]}){return this.document.apply<{ok:boolean}>(OPS.updateComponent,{id,...patch});}
 /** Creates a materialized-instance leaf under `parent` (default root).
  * Box fields default from the component root; `variant` selects a named
  * variant bundle and `overrides` are per-target property overrides.
  * Returns the new node id. */
 createInstance(component:number,options:{parent?:number;name?:string;x?:number;y?:number;width?:number;height?:number;fill?:[number,number,number,number];visible?:boolean;locked?:boolean;variant?:string|null;overrides?:NodeOverride[]|null}={}){return this.document.apply<{node_id:number}>(OPS.createInstance,{component,...options});}
 /** Sets an instance's variant (null clears) and/or replaces its override
  * list (null or [] clears). Absent fields are unchanged. */
 updateInstance(id:number,patch:{variant?:string|null;overrides?:NodeOverride[]|null}){return this.document.apply<{ok:boolean}>(OPS.updateInstance,{id,...patch});}
 /** Materializes one instance's current expansion as ordinary nodes: the
  * instance becomes a frame and expanded descendants get fresh ids.
  * Bindings do not follow clones; overrides are baked. Undo restores. */
 detachInstance(id:number){return this.document.apply<{ok:boolean}>(OPS.detachInstance,{id});}
 /** Read-only component/instance catalog for the tree and variant-picker
  * contracts, plus expansion bounds. Instances report `unavailable_reason`
  * when the document currently exceeds a read expansion bound. */
 describeComponents(){return this.document.apply<ComponentsDescription>(OPS.describeComponents,{});}
 /** Registers a frame/component node as a prototype screen; `entry` marks
  * the FlowOverview entry point. Duplicate nodes reject; use
  * updatePrototypeScreen to change the flag. Removing a screen cascades:
  * its hotspots, attached interactions and interactions targeting it are
  * deleted (undo restores). At most 512 screens. */
 definePrototypeScreen(node:number,options:{entry?:boolean}={}){return this.document.apply<{ok:boolean}>(OPS.definePrototypeScreen,{node,...options});}
 updatePrototypeScreen(node:number,entry:boolean){return this.document.apply<{ok:boolean}>(OPS.updatePrototypeScreen,{node,entry});}
 removePrototypeScreen(node:number){return this.document.apply<{ok:boolean}>(OPS.removePrototypeScreen,{node});}
 /** Creates a normalized (0..=1, inside the unit square) trigger region on
  * a registered screen. `id` is optional (`hotspot-N` assigned); at most
  * 4096 hotspots. Returns the id. */
 definePrototypeHotspot(hotspot:Omit<PrototypeHotspot,'id'>&{id?:string}){const {id,...rest}=hotspot;return this.document.apply<{id:string}>(OPS.definePrototypeHotspot,{...rest,...(id===undefined?{}:{id})});}
 /** Partial patch; absent fields unchanged. `screen` may retarget to
  * another registered screen. */
 updatePrototypeHotspot(id:string,patch:Partial<Omit<PrototypeHotspot,'id'|'screen'>>&{screen?:number}){return this.document.apply<{ok:boolean}>(OPS.updatePrototypeHotspot,{id,...patch});}
 /** Removes the hotspot and every interaction attached to it. */
 removePrototypeHotspot(id:string){return this.document.apply<{ok:boolean}>(OPS.removePrototypeHotspot,{id});}
 /** Creates a named transition preset. `kind:'slide'` requires
  * `direction`; other kinds reject one (updatePrototypeTransition clears
  * it automatically on kind change). `duration_ms` ≤600000. `id` optional
  * (`transition-N`); `label` defaults to the id. At most 256 transitions. */
 definePrototypeTransition(transition:Omit<PrototypeTransition,'id'>&{id?:string}){const {id,...rest}=transition;return this.document.apply<{id:string}>(OPS.definePrototypeTransition,{...rest,...(id===undefined?{}:{id})});}
 /** Partial patch; `direction:null` clears, and a non-slide `kind`
  * normalizes `direction` away before validation. */
 updatePrototypeTransition(id:string,patch:PrototypeTransitionPatch){return this.document.apply<{ok:boolean}>(OPS.updatePrototypeTransition,{id,...patch});}
 /** Removes the preset; rejects while any interaction references it. */
 removePrototypeTransition(id:string){return this.document.apply<{ok:boolean}>(OPS.removePrototypeTransition,{id});}
 /** Creates a PrototypeInteraction attached to exactly one of `hotspot`
  * (id) or `screen` (node). `delay_ms` ≤86400000 is the host-scheduled
  * trigger delay; `duration_ms` ≤600000 overrides the referenced
  * transition's duration. Action/target pairing is enforced:
  * navigate/overlay need a screen target, set-variable a variable target
  * (optional type-matching literal `value`; aliases reject), back and
  * close-overlay carry neither. `id` optional (`interaction-N`); at most
  * 4096 interactions. Returns the id. */
 definePrototypeInteraction(interaction:Omit<PrototypeInteraction,'id'>&{id?:string}){const {id,...rest}=interaction;return this.document.apply<{id:string}>(OPS.definePrototypeInteraction,{...rest,...(id===undefined?{}:{id})});}
 /** Partial patch; explicit `null` clears hotspot/screen/target/
  * transition/duration_ms/value. The exactly-one attachment rule is
  * re-validated, so clearing one side of a both-set pair is required
  * before the other can be set. */
 updatePrototypeInteraction(id:string,patch:PrototypeInteractionPatch){return this.document.apply<{ok:boolean}>(OPS.updatePrototypeInteraction,{id,...patch});}
 removePrototypeInteraction(id:string){return this.document.apply<{ok:boolean}>(OPS.removePrototypeInteraction,{id});}
 /** Read-only catalog projection for the L-08..L-11 contracts: screens
  * (with live node names/kinds/entry flags and authored boxes), hotspots,
  * interactions, transitions and derived navigate/overlay `links`.
  * Silent. */
 prototypeGraph(){return this.document.apply<PrototypeGraph>(OPS.prototypeGraph,{});}
 /** Pure deterministic event resolution — no clock, no playback state.
  * `{hotspot}` matches that region's interactions; `{screen}` matches
  * screen-level interactions plus the screen's hotspot interactions;
  * `trigger` filters when present. First catalog-order match wins; data is
  * `null` when nothing matches. The result carries the resolved transition
  * (interaction `duration_ms` override applied) and `delay_ms` for the
  * host to schedule; `scheduled_by` is always `"host"`. Silent. */
 resolvePrototypeEvent(query:PrototypeEventQuery){return this.document.apply<PrototypeEventResolution|null>(OPS.resolvePrototypeEvent,query);}
 evaluateLayout(){return this.document.apply<{boxes:EvaluatedBox[]}>(OPS.evaluateLayout,{});}
 renderFrame(){return this.document.apply<{width:number;height:number;pixels_b64?:string}>(OPS.renderFrame,{});}
 /** Read-only dev-handoff projection (L-12 storage scope): evaluated
  * measurements, typography, screen membership, deterministic structural
  * hints and the monotonic `state_revision`. Silent — no events, no
  * journal entry, snapshot bytes unchanged. */
 describeHandoff(){return this.document.apply<HandoffDescription>(OPS.describeHandoff,{});}
 /** Read-only RGBA8 raster plus JSON manifest for one frame/component
  * subtree — screen/frame membership scope (L-15). `node` must be a
  * stored frame or component; `scale` ∈ [0.25,4] defaults to 1 and the
  * scaled pixel count must stay within the 1,048,576-pixel output budget.
  * Returns `pixels_b64` on JSON transports (raw RGBA on the binary
  * sidecar for binary-capable hosts); there is no PNG/SVG encoder —
  * per-slice format and presets are host-side. Silent and non-mutating. */
 exportSlice(node:number,options:ExportSliceOptions={}){return this.document.apply<ExportSliceResult>(OPS.exportSlice,{node,...(options.scale===undefined?{}:{scale:options.scale})});}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}
