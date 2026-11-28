import {useLayoutEffect,useMemo,useRef,type ComponentRef,type ReactNode} from "react";
import {Image,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Select} from "@nyc-tron/ui/components/Select";
import {UnitInput} from "@nyc-tron/ui/components/shell/UnitInput";
import {ErrorMessage} from "@nyc-tron/ui/components/feedback/ErrorMessage";
import {PanResponderDrag} from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import type {DragPoint,DragTransport} from "@nyc-tron/ui/components/gestures/drag-transport";
import {ColorChannelFields} from "./ColorChannelFields.tsx";
import type {ChannelModel} from "./channel-fields.ts";
import {rgbToHsv,hsvToRgb,rgbaToHex} from "../color.ts";
import {LinePiece} from "../vector/vector-controls.tsx";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {rasterToImage} from "../layers/layer-thumbnail-model.ts";
import {bounded} from "./color-adjustments.ts";
import {validateMesh,editMeshPoint,rasterizeMesh,type GradientMesh} from "./gradient-mesh.ts";
export type {GradientMesh,MeshPoint} from "./gradient-mesh.ts";
/** Host-owned mesh, selection, preview and one-transaction commit boundaries. */
export interface GradientMeshEditorProps extends Omit<ViewProps,'children'>{
 readonly scope:string;readonly value:GradientMesh;readonly selectedId:string;readonly onSelect:(id:string)=>void;
 readonly onPreview?:(mesh:GradientMesh|undefined)=>void;readonly onCommit:(mesh:GradientMesh)=>void;
 /** Optional color-managed surface replacing the default bilinear sRGB preview. */
 readonly children?:ReactNode;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;readonly transport?:DragTransport;
}
type Local={width:number;preview:GradientMesh|null;error:string|null;model:ChannelModel};
/** Nonfolding mesh node editor with drag previews, exact coordinates and per-node color/alpha. */
export function GradientMeshEditor({scope,value,selectedId,onSelect,onPreview,onCommit,children,height=220,disabled=false,unstyled=false,transport:Transport=PanResponderDrag,...props}:GradientMeshEditorProps){
 validateMesh(value);bounded(height,88,600,'Mesh height');const selected=value.points.find(p=>p.id===selectedId);if(!selected)throw new TypeError('Selected mesh point is unavailable');
 const local=useRef<StoreApi<Local>|null>(null);local.current??=createStore<Local>(()=>({width:0,preview:null,error:null,model:'rgb'}));const store=local.current,state=useStore(store,s=>s);
 const root=useRef<ComponentRef<typeof View>|null>(null),pending=useRef<object|null>(null),drag=useRef<{scope:string;id:string;start:GradientMesh;next:GradientMesh;geometry:{x:number;y:number;width:number;height:number};invalid:boolean}|null>(null);
 const latest=useRef({onPreview,onCommit});latest.current={onPreview,onCommit};
 const cancel=()=>{pending.current=null;const active=drag.current;drag.current=null;store.setState({preview:null});if(active)latest.current.onPreview?.(undefined);};
 useLayoutEffect(()=>{cancel();return cancel;},[scope,disabled]);
 const apply=(point:DragPoint)=>{const d=drag.current;if(!d||disabled||d.scope!==scope)return;const g=d.geometry;try{
  const next=editMeshPoint(d.start,d.id,{x:Math.max(0,Math.min(1,(point.x-g.x-22)/(g.width-44))),y:Math.max(0,Math.min(1,(point.y-g.y-22)/(g.height-44)))});d.next=next;d.invalid=false;store.setState({preview:next,error:null});onPreview?.(next);
 }catch(error){d.invalid=true;store.setState({error:error instanceof Error?error.message:String(error)});}};
 const begin=(point:DragPoint)=>{if(disabled)return;const request={};pending.current=request;root.current?.measureInWindow((x,y,width,h)=>{
  if(pending.current!==request)return;pending.current=null;if(![x,y,width,h].every(Number.isFinite)||width<=44||h<=44)return;
  const hit=value.points.map(p=>({p,d:Math.hypot(x+22+p.x*(width-44)-point.x,y+22+p.y*(h-44)-point.y)})).sort((a,b)=>a.d-b.d)[0];if(!hit||hit.d>44)return;
  onSelect(hit.p.id);drag.current={scope,id:hit.p.id,start:value,next:value,geometry:{x,y,width,height:h},invalid:false};apply(point);
 });};
 const commit=(change:Parameters<typeof editMeshPoint>[2])=>{if(disabled)return;try{const next=editMeshPoint(value,selectedId,change);store.setState({error:null});onCommit(next);}catch(error){store.setState({error:error instanceof Error?error.message:String(error)});}};
 const shown=state.preview??value,width=Math.max(88,state.width||240),w=width-44,h=height-44;
 const previewImage=useMemo(()=>children?null:rasterToImage(rasterizeMesh(shown)),[shown,children]);
 const edges=shown.points.flatMap((p,i)=>[...(i%value.columns<value.columns-1?[[p,shown.points[i+1]!]]:[]),...(i<shown.points.length-value.columns?[[p,shown.points[i+value.columns]!]]:[])]);
 return <View {...props} style={[{gap:8},props.style]}>
  <Select label="Mesh control point" value={selectedId} options={value.points.map((p,i)=>({value:p.id,label:`Row ${Math.floor(i/value.columns)+1}, column ${i%value.columns+1}`}))} disabled={disabled} unstyled={unstyled} onValueChange={onSelect}/>
  <Transport disabled={disabled} onBegin={begin} onMove={(p,n)=>{if(n===1)apply(p);else cancel();}} onCancel={cancel} onRelease={p=>{pending.current=null;apply(p);const d=drag.current;cancel();if(d&&!d.invalid&&!disabled&&d.scope===scope&&d.next.points.some((p,i)=>p.x!==d.start.points[i]!.x||p.y!==d.start.points[i]!.y))onCommit(d.next);}}>
   <View ref={root} collapsable={false} onLayout={e=>store.setState({width:e.nativeEvent.layout.width})} accessibilityLabel="Gradient mesh topology" style={{height,overflow:'hidden'}}>
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden style={{position:'absolute',inset:0}}>{children??(previewImage?<Image accessible={false} source={{uri:previewImage.uri}} resizeMode="stretch" style={{position:'absolute',left:22,top:22,width:w,height:h}}/>:null)}
     {edges.map(([a,b],i)=><LinePiece key={i} from={{x:22+a!.x*w,y:22+a!.y*h}} to={{x:22+b!.x*w,y:22+b!.y*h}} className={joinClasses(!unstyled&&'bg-border')}/>)}
     {shown.points.map(p=><View key={p.id} {...{className:joinClasses(!unstyled&&(p.id===selectedId?'border-primary':'border-text'))}} style={{position:'absolute',left:22+p.x*w-8,top:22+p.y*h-8,width:16,height:16,borderRadius:8, /* radius-exempt: colour-well */borderWidth:2,backgroundColor:rgbaToHex(p.color,true)}}/>)}
    </View>
   </View>
  </Transport>
  <UnitInput label="Mesh X" value={selected.x} min={0} max={1} step={.01} precision={6} disabled={disabled} unstyled={unstyled} onCommit={x=>commit({x})}/>
  <UnitInput label="Mesh Y" value={selected.y} min={0} max={1} step={.01} precision={6} disabled={disabled} unstyled={unstyled} onCommit={y=>commit({y})}/>
  <ColorChannelFields value={rgbToHsv(selected.color)} model={state.model} onModelChange={model=>store.setState({model})} disabled={disabled} unstyled={unstyled} onCommit={color=>commit({color:hsvToRgb(color)})}/>
  <ErrorMessage {...(state.error?{message:state.error}:{})} unstyled={unstyled}/>
 </View>;
}
