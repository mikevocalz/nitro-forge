import {useMemo} from 'react';
import {Button,Text,View} from '@nitro-forge/studio-workspace/ui';
import {ShapeBuilder} from '@nyc-tron/ui/components/forge/vector/ShapeBuilder';
import {FillStrokeInspector} from '@nyc-tron/ui/components/forge/vector/FillStrokeInspector';
import type {BuilderLayer,BooleanGroup} from '@nyc-tron/ui/components/forge/vector/shape-builder-model';
import type {ContentBounds} from '@nyc-tron/ui/components/forge/vector/fill-stroke-model';
import type {PrismDocument} from '../../../packages/prism/src/index';
import {PrismCanvasAdapter,type PrismCanvasState} from '../../../packages/prism/src/canvas-cluster';

type Layer=PrismCanvasState['layers'][number];
/** Content-space control hull: a real envelope of the path's anchors and Bezier handles.
 * New gradient defaults span this hull; this is not a rendered-pixel bounds claim. */
function controlHull(layer:Layer):ContentBounds|null{
 if(layer.content.type!=='path')return null;
 const points=layer.content.path.subpaths.flatMap(path=>path.nodes.flatMap(node=>[
  [node.x,node.y],...(node.in?[[node.x+node.in[0],node.y+node.in[1]]]:[]),...(node.out?[[node.x+node.out[0],node.y+node.out[1]]]:[]),
 ]));
 if(!points.length)return null;
 const limits=points.reduce((box,point)=>({left:Math.min(box.left,point[0]!),top:Math.min(box.top,point[1]!),right:Math.max(box.right,point[0]!),bottom:Math.max(box.bottom,point[1]!)}),{left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity});
 const x=limits.left,y=limits.top,width=limits.right-x,height=limits.bottom-y;
 return Number.isFinite(x+y+width+height)&&width>0&&height>0?{x,y,width,height}:null;
}
export interface PrismVectorControlsProps{
 document:PrismDocument;state:PrismCanvasState;layerId:number|null;disabled:boolean;
 /** Already scoped to this authoritative document/selection generation. */
 write:(action:()=>Promise<unknown>)=>Promise<void>;
}
/** App-local mapping only; NYC-Tron owns vector interaction and availability UI. */
export function PrismVectorControls({document,state,layerId,disabled,write}:PrismVectorControlsProps){
 const adapter=useMemo(()=>new PrismCanvasAdapter(document),[document]);
 const builder=(layer:Layer):BuilderLayer=>{
  const parent=state.layers.find(item=>item.id===layer.parent)?.content.type;
  return {id:layer.id,name:layer.name,kind:layer.content.type,parent:layer.parent,locked:layer.locked,
   ...(parent==='group'||parent==='boolean'?{parentKind:parent}:{})};
 };
 const focused=state.layers.find(layer=>layer.id===layerId);
 const selected=state.layers.filter(layer=>state.selected.includes(layer.id));
 const candidate=focused?.content.type==='boolean'?focused:state.layers.find(layer=>layer.id===focused?.parent&&layer.content.type==='boolean');
 const group:BooleanGroup|undefined=candidate?.content.type==='boolean'?{id:candidate.id,name:candidate.name,op:candidate.content.op,locked:candidate.locked,
  operands:state.layers.filter(layer=>layer.parent===candidate.id).reverse().map(builder)}:undefined;
 const boolean=adapter.booleans();
 const groupable=selected.length>=2&&selected.every(layer=>!layer.locked&&layer.parent===selected[0]!.parent)&&
  !state.layers.some(layer=>layer.id===selected[0]?.parent&&layer.content.type==='boolean');
 const path=focused?.content.type==='path'?focused.content.path:null;
 const bounds=focused?controlHull(focused):null;
 const vector=focused?adapter.vector(focused.id):null;
 return <View style={{gap:12}}>
  {/* alpha.4 controls lack host disabled props, so they are withheld while admission is closed. */}
  {!disabled&&<ShapeBuilder selection={selected.map(builder)} {...(group?{group}:{})}
   onBoolean={request=>write(()=>boolean.onBoolean(request))}
   onSetBooleanOp={request=>write(()=>boolean.onSetBooleanOp(request))}
   onRelease={request=>write(()=>boolean.onRelease(request))}
   onExpand={request=>write(()=>boolean.onExpand(request))}/>}
  <Button title="Group selected layers" disabled={disabled||!groupable} onPress={()=>{void write(()=>document.groupLayers(selected.map(layer=>layer.id))).catch(()=>undefined);}}/>
  {focused?.content.type==='group'&&<Button title="Ungroup layer" disabled={disabled||focused.locked} onPress={()=>{void write(()=>document.ungroupLayer(focused.id)).catch(()=>undefined);}}/>}
  {path&&focused&&vector&&bounds&&!disabled&&!focused.locked&&<>
   <Text>Path fill and stroke. New gradients span the path control points.</Text>
   <FillStrokeInspector kind="path" fill={path.fill} stroke={path.stroke?{...path.stroke,join:path.stroke.join??'miter',cap:path.stroke.cap??'butt',miter_limit:path.stroke.miter_limit??4,dash:path.stroke.dash??[],dash_offset:path.stroke.dash_offset??0}:null} fillRule={path.fill_rule} paintOrder={path.paint_order} bounds={bounds}
    swatches={[]} onSetFill={paint=>write(()=>vector.onSetFill(paint))} onSetStroke={stroke=>write(()=>vector.onSetStroke(stroke))}
    onSetFillRule={rule=>write(()=>vector.onSetFillRule(rule))} onSetPaintOrder={order=>write(()=>vector.onSetPaintOrder(order))}/>
  </>}
  {path&&!bounds&&<Text>Fill and stroke editing needs a path with a nonzero control-point width and height.</Text>}
 </View>;
}
