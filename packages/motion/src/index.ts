import {DocumentHandle,bytesToBase64,type EngineHost} from '@nitro-forge/ignition';
export type MotionProperty='tx'|'ty'|'sx'|'sy'|'rotation'|'ox'|'oy'|'opacity';
export interface CurvePoint{time:number;value:number}
export interface MotionKey extends CurvePoint{id:number;interpolation:'hold'|'linear'|'bezier';in_handle:CurvePoint|null;out_handle:CurvePoint|null}
export type MotionKeyInput=Omit<MotionKey,'id'>&{id?:number};
export interface Transform{tx:number;ty:number;sx:number;sy:number;rotation:number;ox:number;oy:number}
export interface Shape{kind:'rect'|'ellipse';x:number;y:number;w:number;h:number;fill:[number,number,number,number]}
export type LayerKind='shape'|'raster'|'comp';
/** The 13 W3C Compositing Level 1 blend modes Prism implements; `null`/`"normal"` is the default source-over. */
export type MotionBlendMode='normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'|'add';
/** Track-matte modes: alpha/luma read the matte source's rendered subtree; inverted modes complement the derived mask. */
export type MotionMatteMode='alpha'|'alpha-inverted'|'luma'|'luma-inverted';
/** A stored matte as reported by describe/evaluate; `feather` is bounded 0..=64 and `enabled:false` stores without masking. */
export interface MotionMatte{source_layer:number;mode:MotionMatteMode;feather:number;enabled:boolean}
/** setLayerMatte input: feather defaults to 0 and enabled defaults to true. */
export interface MotionMatteInput{source_layer:number;mode:MotionMatteMode;feather?:number;enabled?:boolean}
interface MotionLayerCommon{id:number;name:string;visible:boolean;locked:boolean;kind:LayerKind;transform:Transform;opacity:number;curves:{property:MotionProperty;keys:MotionKey[]}[];parent_id?:number;blend?:MotionBlendMode;clipped?:boolean;matte?:MotionMatte}
/** Exactly one real content source; no placeholder shape for raster or comp layers. `comp` is the composition id a comp layer instantiates (0 is never a valid target). */
export type MotionLayer=MotionLayerCommon&({shape:Shape;asset_id?:never;comp_id?:never}|{asset_id:number;shape?:never;comp_id?:never}|{comp_id:number;shape?:never;asset_id?:never});
export const MOTION_RASTER_FORMAT='rgba8-straight-srgb' as const;
export interface MotionRasterAsset{readonly id:number;readonly width:number;readonly height:number;readonly format:typeof MOTION_RASTER_FORMAT;readonly pixels_b64:string}
export interface CompositionSettings{title:string;width:number;height:number;duration_s:number;frame_rate:{num:number;den:number}}
/** A nested composition; the root composition is the document header (title/width/height/duration_s/frame_rate) plus `layers`. */
export interface MotionComposition{id:number;name:string;width:number;height:number;duration_s:number;frame_rate:{num:number;den:number};layers:MotionLayer[]}
/** describe always materializes assets:{}, compositions:{} and both next_* counters, including legacy shape snapshots. */
export interface MotionState extends CompositionSettings{kind:'motion';schema:1|2;next_layer_id:number;next_key_id:number;layers:MotionLayer[];compositions:Readonly<Record<string,MotionComposition>>;next_comp_id:number;assets:Readonly<Record<string,MotionRasterAsset>>;next_asset_id:number}
export interface MotionEvaluation{layers:MotionLayer[];compositions:Readonly<Record<string,MotionComposition>>}
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
 /** Move a layer to another composition at `index`; comp 0 selects the root. Cross-comp moves clear transform-parent links. */
 reparentLayer(layer:number,comp:number,index:number){return this.document.apply<{ok:boolean}>('reparentLayer',{layer,comp,index});}
 updateLayer(id:number,patch:Partial<Pick<MotionLayer,'name'|'visible'|'locked'|'opacity'|'shape'|'asset_id'>>&{transform?:Partial<Transform>}){return this.document.apply<{ok:boolean}>('updateLayer',{...patch,id});}
 removeLayer(id:number){return this.document.apply<{ok:boolean}>('removeLayer',{id});}
 setLayerOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setLayerOrder',{order});}
 setPropertyKeys(layer:number,property:MotionProperty,keys:readonly MotionKeyInput[]){return this.document.apply<{key_ids:number[]}>('setPropertyKeys',{layer,property,keys});}
 /** Root layers plus each composition evaluated at its duration-scaled local time; curves are cleared in output. */
 evaluate(time_s:number){return this.document.apply<MotionEvaluation>('evaluate',{time_s});}
 /** One real bounded RGBA frame; no encoding, file delivery or render queue. */
 renderFrame(time_s:number){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',{time_s});}
 save(){return this.document.snapshot();} undo(){return this.document.undo();} redo(){return this.document.redo();} close(){return this.document.close();}
}
