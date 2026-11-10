import {base64ToBytes} from '@nitro-forge/ignition';
import type {PrismDocument,Shape} from './index';
import type {Rgba} from './rgba';
import type {AlignEdge,AlignTarget,Artboard,BlendMode,BooleanOp,FillRule,LayerTransform,NodeKind,Paint,PaintOrder,PathNode,PixelPreview,SelectionMode,SelectionShape,Stroke,Subpath} from './canvas-types';

type Immutable<T> = T extends object ? {readonly [K in keyof T]:Immutable<T[K]>} : T;
export type CanvasPaint = Immutable<Paint>;
export type CanvasStroke = Immutable<Stroke>;
export type CanvasNode = Immutable<PathNode>;
export type CanvasSubpath = Immutable<Subpath>;
export type CanvasRegion = Immutable<SelectionShape>;
export type CanvasId = string|number;

/** Authoritative engine state. Canvas, selection and artboard UI reads this after each write. */
export interface PrismCanvasState {
  readonly width:number;readonly height:number;readonly next_id:number;readonly selected:readonly number[];readonly artboards:readonly Artboard[];readonly selection_b64?:string|null;
  readonly layers:readonly {id:number;name:string;visible:boolean;opacity:number;locked:boolean;blend:BlendMode;parent:number|null;clipped:boolean;
    transform:LayerTransform;mask:{enabled:boolean;inverted:boolean;mask_b64:string}|null;
    content:{type:'raster';pixels_b64:string}|{type:'shape';shape:Shape}|{type:'group'}|
      {type:'path';path:{subpaths:Subpath[];fill:Paint|null;stroke:Stroke|null;fill_rule:FillRule;paint_order:PaintOrder}}|
      {type:'boolean';op:BooleanOp;fill:Paint|null}}[];
}

function id(value:CanvasId):number {
  if(typeof value==='string'&&!/^(0|[1-9]\d*)$/.test(value))throw new RangeError(`Not a Prism id: ${value}`);
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw new RangeError(`Not a Prism id: ${value}`);
  return n;
}
const rgba=(c:readonly [number,number,number,number]):Rgba=>[c[0],c[1],c[2],c[3]];
function paint(p:CanvasPaint):Paint {
  if(p.type==='solid')return {type:'solid',color:rgba(p.color)};
  return {...p,stops:p.stops.map(s=>({offset:s.offset,color:rgba(s.color)}))};
}
function node(n:CanvasNode):PathNode {
  const {in:a,out:b,...rest}=n;
  return {...rest,...(a?{in:[a[0],a[1]] as [number,number]}:{}),...(b?{out:[b[0],b[1]] as [number,number]}:{})};
}
const subpaths=(paths:readonly CanvasSubpath[]):Subpath[]=>paths.map(p=>({closed:p.closed,nodes:p.nodes.map(node)}));
function raster(value:PixelPreview){return {width:value.width,height:value.height,pixels:base64ToBytes(value.pixels_b64)};}

/**
 * Domain bindings for NYC-Tron's canvas/layers controls. Each committed intent
 * writes to the real engine before returning its fresh state; no optimistic
 * document is held here. The host publishes successful results and presents
 * rejections through its existing error surface. Grid, guides, reference images,
 * gesture preferences, viewport and selection focus remain host-owned.
 */
export class PrismCanvasAdapter {
  constructor(private readonly doc:PrismDocument){}
  async read():Promise<PrismCanvasState>{return (await this.doc.describe<PrismCanvasState>()).data;}
  private async commit(write:Promise<unknown>):Promise<PrismCanvasState>{await write;return this.read();}

  /** A fresh bounded RGBA render for compare/reference surfaces. */
  async renderRegion(region:{x:number;y:number;w:number;h:number;max:number}){
    return raster((await this.doc.renderRegion(region.x,region.y,region.w,region.h,region.max)).data);
  }

  alignment(){return {
    onAlign: (request:{ids:readonly string[];align:AlignEdge;to:'selection'|'canvas'|{readonly artboard:string}})=>{
      const to:AlignTarget=typeof request.to==='string'?request.to:{artboard:id(request.to.artboard)};
      return this.commit(this.doc.alignLayers(request.ids.map(id),request.align,to));
    },
    onDistribute: (request:{ids:readonly string[];axis:'horizontal'|'vertical';mode:'centers'|'spacing';spacing?:number})=>{
      const {ids,axis,...options}=request;
      return this.commit(this.doc.distributeLayers(ids.map(id),axis,options));
    },
    onMoveLayer: (request:{id:string;to_index:number})=>this.commit(this.doc.moveLayer(id(request.id),request.to_index)),
  };}

  /** One content-space pivot change; the engine compensates translation. */
  origin(layerId:CanvasId){return {onSetOrigin:(ox:number,oy:number)=>this.commit(this.doc.setTransformOrigin(id(layerId),ox,oy))};}

  selection(){return {
    onSelectRegion: (request:{shape:CanvasRegion;mode:SelectionMode;feather?:number})=>{
      const shape:SelectionShape=request.shape.kind==='polygon'
        ?{kind:'polygon',points:request.shape.points.map(([x,y]):[number,number]=>[x,y])}:request.shape;
      return this.commit(this.doc.selectRegion(shape,request.mode,request.feather));
    },
    onSelectAll: ()=>this.commit(this.doc.selectAll()),
    onDeselect: ()=>this.commit(this.doc.deselect()),
    onInvertSelection: ()=>this.commit(this.doc.invertSelection()),
    onMagicWand: (request:{x:number;y:number;tolerance:number;contiguous:boolean;sample:'composite'|{readonly layer:CanvasId};mode:SelectionMode})=>
      this.commit(this.doc.magicWand({...request,sample:request.sample==='composite'?'composite':{layer:id(request.sample.layer)}})),
    onModifySelection: (request:{op:'grow'|'shrink'|'feather';radius:number})=>this.commit(this.doc.modifySelection(request.op,request.radius)),
  };}

  masks(){return {
    onAddMask:(r:{id:string;fill:'reveal'|'hide'|'selection'})=>this.commit(this.doc.addMask(id(r.id),r.fill)),
    onRemoveMask:(r:{id:string;apply:boolean})=>this.commit(this.doc.removeMask(id(r.id),r.apply)),
    onSetMaskEnabled:(r:{id:string;enabled:boolean})=>this.commit(this.doc.setMaskEnabled(id(r.id),r.enabled)),
    onInvertMask:(r:{id:string})=>this.commit(this.doc.invertMask(id(r.id))),
    onRefineMask:(r:{id:string;feather:number;grow:number})=>this.commit(this.doc.refineMask(id(r.id),r.feather,r.grow)),
    loadMaskThumbnail:async(layerId:string,max:number)=>raster((await this.doc.maskThumbnail(id(layerId),max)).data),
  };}

  layers(){return {
    onSetClipped:(r:{id:string;clipped:boolean})=>this.commit(this.doc.setClipped(id(r.id),r.clipped)),
    setLocked:(layerId:CanvasId,locked:boolean)=>this.commit(this.doc.setLayerLocked(id(layerId),locked)),
    setBlend:(layerId:CanvasId,blend:BlendMode)=>this.commit(this.doc.setLayerBlend(id(layerId),blend)),
    select:(ids:readonly CanvasId[])=>this.commit(this.doc.selectLayers(ids.map(id))),
    loadThumbnail:async(layerId:string,max:number)=>raster((await this.doc.layerThumbnail(id(layerId),max)).data),
  };}

  artboards(){return {
    onAddArtboard:(r:{name?:string;x:number;y:number;w:number;h:number})=>this.commit(this.doc.addArtboard(r,r.name)),
    onUpdateArtboard:(r:{id:string;name?:string;x?:number;y?:number;w?:number;h?:number})=>{
      const {id:boardId,...patch}=r;return this.commit(this.doc.updateArtboard(id(boardId),patch));
    },
    onRemoveArtboard:(r:{id:string})=>this.commit(this.doc.removeArtboard(id(r.id))),
    onMoveArtboard:(r:{id:string;to_index:number})=>this.commit(this.doc.moveArtboard(id(r.id),r.to_index)),
    loadThumbnail:async(boardId:string,max:number)=>raster((await this.doc.artboardThumbnail(id(boardId),max)).data),
  };}

  vector(layerId:CanvasId){
    const layer=id(layerId);
    const setFill=(value:CanvasPaint|null)=>this.commit(this.doc.setFill(layer,value?paint(value):null));
    return {
      onSetPathNode:(r:{subpath:number;index:number;node:CanvasNode})=>this.commit(this.doc.setPathNode(layer,r.subpath,r.index,node(r.node))),
      onInsertNode:(r:{subpath:number;index:number;node:CanvasNode;subpaths:readonly CanvasSubpath[];neighborsChanged:boolean})=>
        this.commit(r.neighborsChanged?this.doc.setPathNodes(layer,subpaths(r.subpaths)):this.doc.insertPathNode(layer,r.subpath,r.index,node(r.node))),
      onRemoveNode:(r:{subpath:number;index:number})=>this.commit(this.doc.removePathNode(layer,r.subpath,r.index)),
      onSetNodeKind:(r:{subpath:number;index:number;kind:NodeKind;node:CanvasNode;handlesChanged:boolean})=>
        this.commit(r.handlesChanged?this.doc.setPathNode(layer,r.subpath,r.index,node(r.node)):this.doc.setNodeKind(layer,r.subpath,r.index,r.kind)),
      onSetClosed:(r:{subpath:number;closed:boolean})=>this.commit(this.doc.setSubpathClosed(layer,r.subpath,r.closed)),
      onSetFill:setFill,
      onSetStroke:(value:CanvasStroke|null)=>{
        if(!value)return this.commit(this.doc.setStroke(layer,null));
        const {dash,paint:p,...rest}=value;
        return this.commit(this.doc.setStroke(layer,{...rest,paint:paint(p),...(dash?{dash:[...dash]}:{})}));
      },
      onSetFillRule:(value:FillRule)=>this.commit(this.doc.setFillRule(layer,value)),
      onSetPaintOrder:(value:PaintOrder)=>this.commit(this.doc.setPaintOrder(layer,value)),
    };
  }

  booleans(){return {
    onBoolean:(r:{ids:readonly CanvasId[];op:BooleanOp})=>this.commit(this.doc.booleanLayers(r.ids.map(id),r.op)),
    onSetBooleanOp:(r:{id:CanvasId;op:BooleanOp})=>this.commit(this.doc.setBooleanOp(id(r.id),r.op)),
    onRelease:(r:{id:CanvasId})=>this.commit(this.doc.ungroupLayer(id(r.id))),
    onExpand:(r:{id:CanvasId})=>this.commit(this.doc.rasterizeLayer(id(r.id))),
    onSelectOperand:(layerId:CanvasId)=>this.commit(this.doc.selectLayers([id(layerId)])),
  };}

  /** The host resolves its colour format; no CSS colour is silently guessed. */
  colorDrop(layerId:CanvasId,resolveColor:(color:string)=>readonly [number,number,number,number]){
    return {onFill:(r:{x:number;y:number;color:string;tolerance:number;contiguous:boolean})=>
      this.commit(this.doc.floodFill(id(layerId),{...r,color:rgba(resolveColor(r.color))}))};
  }
}


/** Top-to-bottom clipping rows with UI string ids; parent grouping is retained. */
export function canvasClippingRows(state:PrismCanvasState){
  return [...state.layers].reverse().map(layer=>({id:String(layer.id),name:layer.name,clipped:layer.clipped,
    parent:layer.parent===null?null:String(layer.parent)}));
}

/** Path nodes as the controlled editor expects; the engine defaults omitted kinds to corner. */
export function canvasPathNodes(paths:readonly Subpath[]){
  return paths.map(p=>({...p,nodes:p.nodes.map(n=>({...n,kind:n.kind??'corner'}))}));
}
