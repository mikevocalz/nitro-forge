import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
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
 evaluateLayout:'evaluateLayout',
 renderFrame:'renderFrame',
} as const;
export type SizeMode='fixed'|'hug'|'fill';
export type Axis='x'|'y';
export interface AxisSizing {mode:SizeMode;value:number;fixedValue:number;resolvedValue:number;canHug:boolean;canFill:boolean;unavailableReason?:string;hugReason?:string;fillReason?:string}
export type AxisSizingUpdate={mode:'fixed';value?:number}|{mode:'hug'|'fill'};
export type SizingSettings={x:SizeMode;y:SizeMode};
export type NodeKind='frame'|'rect'|'ellipse'|'text';
export type TextFontStyle='normal'|'italic';
/** Bounded text style; content ≤64KiB UTF-8, font_family ≤256 bytes, font_size>0≤1e4, font_weight 1..=1000. */
export interface TextStyle{content:string;font_family:string;font_size:number;font_weight:number;font_style:TextFontStyle}
/** Partial text patch accepted by updateNode `text` and addText `style` font fields. */
export type TextStylePatch=Partial<Omit<TextStyle,'content'>>;
export interface FrameLayout{direction:'row'|'column';wrap?:boolean;gap:number;padding_top:number;padding_right:number;padding_bottom:number;padding_left:number;align:'start'|'center'|'end'|'stretch';justify:'start'|'center'|'end'|'space-between'}
export interface NodeGeometry{x:number;y:number;width:number;height:number}
export interface DesignNode extends NodeGeometry{id:number;kind:NodeKind;name:string;fill:[number,number,number,number];visible:boolean;locked:boolean;children:number[];layout:FrameLayout|null;sizing?:SizingSettings;text?:TextStyle}
export interface CompositionSettings{title:string;width:number;height:number}
/** describe/evaluateLayout expose the internal schema:1 state; the schema:2
 * wrapper `{kind:'design',schema:2,document}` exists only inside snapshot
 * bytes and only when text nodes are present. */
export interface DesignState{kind:'design';schema:1;title:string;next_id:number;nodes:Record<string,DesignNode>}
export type NodePatch=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'|'locked'>> & {text?:TextStylePatch|null};
export type NewNode=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'>>;
export interface NewTextNode extends NewNode{content:string;style?:TextStylePatch}
export interface EvaluatedBox extends NodeGeometry{id:number;kind:NodeKind;fill:[number,number,number,number];visible:boolean;renderable:boolean}
/** Bounded fixed/hug/fill layout and real Prism RGBA. Text nodes are layout
 * boxes only (renderable:false, fill background draws, no glyphs); no
 * constraints, components, variables, prototype runtime, images or clipping. */
export class DesignDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,settings:Partial<CompositionSettings>={}){return new DesignDocument(await DocumentHandle.openInitialized(host,'design',doc=>doc.apply(OPS.new,settings)));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new DesignDocument(await DocumentHandle.openSnapshot(host,'design',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<DesignState>(OPS.describe,{});}
 setComposition(patch:Partial<CompositionSettings>){return this.document.apply<{ok:boolean}>(OPS.setComposition,patch);}
 addFrame(parent:number,node:NewNode={}){return this.document.apply<{node_id:number}>(OPS.addFrame,{...node,parent});}
 addShape(parent:number,kind:'rect'|'ellipse',node:NewNode={}){return this.document.apply<{node_id:number}>(OPS.addShape,{...node,parent,kind});}
 /** parent defaults to the root canvas when omitted. `style` carries font fields only; content is top-level. */
 addText(parent:number|undefined,node:NewTextNode){const {content,style,...rest}=node;return this.document.apply<{node_id:number}>(OPS.addText,{...rest,...(parent===undefined?{}:{parent}),content,...(style?{style}:{})});}
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
 evaluateLayout(){return this.document.apply<{boxes:EvaluatedBox[]}>(OPS.evaluateLayout,{});}
 renderFrame(){return this.document.apply<{width:number;height:number;pixels_b64?:string}>(OPS.renderFrame,{});}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}
