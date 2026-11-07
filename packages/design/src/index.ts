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
 evaluateLayout:'evaluateLayout',
 renderFrame:'renderFrame',
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
export interface FrameLayout{direction:'row'|'column';wrap?:boolean;gap:number;padding_top:number;padding_right:number;padding_bottom:number;padding_left:number;align:'start'|'center'|'end'|'stretch';justify:'start'|'center'|'end'|'space-between'}
export interface NodeGeometry{x:number;y:number;width:number;height:number}
export interface DesignNode extends NodeGeometry{id:number;kind:NodeKind;name:string;fill:[number,number,number,number];visible:boolean;locked:boolean;children:number[];layout:FrameLayout|null;sizing?:SizingSettings;text?:TextStyle;constraints?:NodeConstraints;variants?:ComponentVariant[];instance?:InstanceSpec}
export interface CompositionSettings{title:string;width:number;height:number}
/** describe/evaluateLayout expose the internal schema:1 state; the schema:2
 * wrapper `{kind:'design',schema:2,document}` exists only inside snapshot
 * bytes and only when schema-2 features (text nodes, node constraints,
 * variables/modes/bindings)
 * are present. The collections are omitted entirely when empty. */
export interface DesignState{kind:'design';schema:1;title:string;next_id:number;nodes:Record<string,DesignNode>;variables?:Record<string,DesignVariable>;modes?:DesignMode[];active_mode?:string;bindings?:VariableBinding[]}
export type NodePatch=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'|'locked'>> & {text?:TextStylePatch};
export type NewNode=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'>>;
export interface NewTextNode extends NewNode{content:string;style?:FontStylePatch}
export interface EvaluatedBox extends NodeGeometry{id:number;kind:NodeKind;fill:[number,number,number,number];visible:boolean;renderable:boolean}
export interface ComponentDescription{id:number;name:string;variants:{name:string;properties:NodeOverride[]}[]}
export interface InstanceDescription{id:number;name:string;component:number|null;variant:string|null;overrides:NodeOverride[];unavailable_reason?:string}
export interface ComponentsDescription{expansion:{max_depth:number;max_nodes:number;persisted:boolean};components:ComponentDescription[];instances:InstanceDescription[]}
/** Bounded fixed/hug/fill layout and real Prism RGBA plus variables/modes.
 * Text nodes are layout boxes only (renderable:false, fill background draws,
 * no glyphs); bindings resolve at read/render time and never bake into nodes.
 * Constraints are stored h/v anchors on absolute children only — storage and
 * validation, not solving (evaluateLayout ignores them in C1/C2). Components
 * and instances exist: instances expand deterministically at read/render
 * time only (never persisted expanded) under depth/node caps, with a bounded
 * override surface and named variant bundles. Instance sizing stays fixed.
 * No prototype runtime, images, clipping, groups or layers. */
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
 evaluateLayout(){return this.document.apply<{boxes:EvaluatedBox[]}>(OPS.evaluateLayout,{});}
 renderFrame(){return this.document.apply<{width:number;height:number;pixels_b64?:string}>(OPS.renderFrame,{});}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}
