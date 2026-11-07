import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
export type MotionProperty='tx'|'ty'|'sx'|'sy'|'rotation'|'ox'|'oy'|'opacity';
export interface CurvePoint{time:number;value:number}
export interface MotionKey extends CurvePoint{id:number;interpolation:'hold'|'linear'|'bezier';in_handle:CurvePoint|null;out_handle:CurvePoint|null}
export type MotionKeyInput=Omit<MotionKey,'id'>&{id?:number};
export interface Transform{tx:number;ty:number;sx:number;sy:number;rotation:number;ox:number;oy:number}
export interface Shape{kind:'rect'|'ellipse';x:number;y:number;w:number;h:number;fill:[number,number,number,number]}
export interface MotionLayer{id:number;name:string;visible:boolean;locked:boolean;shape:Shape;transform:Transform;opacity:number;curves:{property:MotionProperty;keys:MotionKey[]}[]}
export interface CompositionSettings{title:string;width:number;height:number;duration_s:number;frame_rate:{num:number;den:number}}
export interface MotionState extends CompositionSettings{kind:'motion';schema:1;next_layer_id:number;next_key_id:number;layers:MotionLayer[]}
export class MotionDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,settings:Partial<CompositionSettings>={}){return new MotionDocument(await DocumentHandle.openInitialized(host,'motion',doc=>doc.apply('new',settings)));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new MotionDocument(await DocumentHandle.openSnapshot(host,'motion',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<MotionState>('describe',{});}
 setComposition(patch:Partial<CompositionSettings>){return this.document.apply<{ok:boolean}>('setComposition',patch);}
 addShapeLayer(shape:Shape,name?:string){return this.document.apply<{layer_id:number}>('addShapeLayer',{shape,...(name===undefined?{}:{name})});}
 updateLayer(id:number,patch:Partial<Pick<MotionLayer,'name'|'visible'|'locked'|'opacity'|'shape'>>&{transform?:Partial<Transform>}){return this.document.apply<{ok:boolean}>('updateLayer',{...patch,id});}
 removeLayer(id:number){return this.document.apply<{ok:boolean}>('removeLayer',{id});}
 setLayerOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setLayerOrder',{order});}
 setPropertyKeys(layer:number,property:MotionProperty,keys:readonly MotionKeyInput[]){return this.document.apply<{key_ids:number[]}>('setPropertyKeys',{layer,property,keys});}
 evaluate(time_s:number){return this.document.apply<{layers:MotionLayer[]}>('evaluate',{time_s});}
 /** One real bounded RGBA frame; no encoding, file delivery or render queue. */
 renderFrame(time_s:number){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',{time_s});}
 save(){return this.document.snapshot();} undo(){return this.document.undo();} redo(){return this.document.redo();} close(){return this.document.close();}
}
