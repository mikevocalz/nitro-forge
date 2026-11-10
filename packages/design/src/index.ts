import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
export type SizeMode='fixed'|'hug'|'fill';
export type Axis='x'|'y';
export interface AxisSizing {mode:SizeMode;value:number;fixedValue:number;resolvedValue:number;canHug:boolean;canFill:boolean;unavailableReason?:string;hugReason?:string;fillReason?:string}
export type AxisSizingUpdate={mode:'fixed';value?:number}|{mode:'hug'|'fill'};
export type SizingSettings={x:SizeMode;y:SizeMode};
export type NodeKind='frame'|'rect'|'ellipse';
export interface FrameLayout{direction:'row'|'column';wrap?:boolean;gap:number;padding_top:number;padding_right:number;padding_bottom:number;padding_left:number;align:'start'|'center'|'end'|'stretch';justify:'start'|'center'|'end'|'space-between'}
export interface NodeGeometry{x:number;y:number;width:number;height:number}
export interface DesignNode extends NodeGeometry{id:number;kind:NodeKind;name:string;fill:[number,number,number,number];visible:boolean;locked:boolean;children:number[];layout:FrameLayout|null;sizing?:SizingSettings}
export interface CompositionSettings{title:string;width:number;height:number}
export interface DesignState{kind:'design';schema:1;title:string;next_id:number;nodes:Record<string,DesignNode>}
export type NodePatch=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'|'locked'>>;
export type NewNode=Partial<Pick<DesignNode,'name'|'x'|'y'|'width'|'height'|'fill'|'visible'>>;
export interface EvaluatedBox extends NodeGeometry{id:number;kind:NodeKind;fill:[number,number,number,number];visible:boolean}
/** Bounded fixed/hug/fill layout and real RGBA only; no text, clipping or prototype runtime. */
export class DesignDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,settings:Partial<CompositionSettings>={}){return new DesignDocument(await DocumentHandle.openInitialized(host,'design',doc=>doc.apply('new',settings)));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new DesignDocument(await DocumentHandle.openSnapshot(host,'design',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<DesignState>('describe',{});}
 setComposition(patch:Partial<CompositionSettings>){return this.document.apply<{ok:boolean}>('setComposition',patch);}
 addFrame(parent:number,node:NewNode={}){return this.document.apply<{node_id:number}>('addFrame',{...node,parent});}
 addShape(parent:number,kind:'rect'|'ellipse',node:NewNode={}){return this.document.apply<{node_id:number}>('addShape',{...node,parent,kind});}
 updateNode(id:number,patch:NodePatch){return this.document.apply<{ok:boolean}>('updateNode',{...patch,id});}
 /** Fixed without a value freezes evaluated size; explicit fixed values resize. Other modes retain authored fallback. */
 setAxisSizing(id:number,axis:Axis,update:AxisSizingUpdate){return this.document.apply<{ok:boolean}>('setAxisSizing',{id,axis,mode:update.mode,...(update.mode==='fixed'&&update.value!==undefined?{value:update.value}:{})});}
 readAxisSizing(id:number){return this.document.apply<{x:AxisSizing;y:AxisSizing}>('readAxisSizing',{id});}
 /** null restores absolute child positioning. */
 setFrameLayout(id:number,layout:FrameLayout|null){return this.document.apply<{ok:boolean}>('setFrameLayout',{id,layout});}
 setChildOrder(parent:number,order:readonly number[]){return this.document.apply<{ok:boolean}>('setChildOrder',{parent,order});}
 /** Preserves authored local coordinates; index is in the destination after removal. */
 reparentNode(id:number,parent:number,index:number){return this.document.apply<{ok:boolean}>('reparentNode',{id,parent,index});}
 removeNode(id:number){return this.document.apply<{ok:boolean}>('removeNode',{id});}
 evaluateLayout(){return this.document.apply<{boxes:EvaluatedBox[]}>('evaluateLayout',{});}
 renderFrame(){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',{});}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}
