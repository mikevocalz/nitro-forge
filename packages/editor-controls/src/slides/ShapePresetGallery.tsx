import {useLayoutEffect,useRef} from 'react';
import {View,Text} from 'react-native';
import type {ReactNode} from 'react';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {AssetPresetGallery,type AssetPresetGalleryProps} from '../inputs/AssetPresetGallery.tsx';
import {PropertyInspector,type InspectorProperty} from '../inputs/PropertyInspector.tsx';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
export interface ShapeAdjustmentHandle {id:string;label:string;x:number;y:number;axis:'x'|'y';value:number;min:number;max:number}
export interface ShapePresetGalleryProps extends Omit<AssetPresetGalleryProps,'label'|'selectedIds'> {
 selectedId:string|null;adjustments:readonly InspectorProperty[];handles:readonly ShapeAdjustmentHandle[];canvasAspectRatio:number;
 renderAdjustmentPreview:(id:string,values:Readonly<Record<string,number>>)=>ReactNode;
 onAdjustmentCommit:(id:string,value:number|string|boolean,signal?:AbortSignal)=>unknown;
}
/** Source-backed vector previews and a selected native drag handle, plus numeric/keyboard alternatives. */
export function ShapePresetGallery({scope='shape-presets',revision=0,...props}:ShapePresetGalleryProps){
 const {selectedId,adjustments,handles,canvasAspectRatio,renderAdjustmentPreview,onAdjustmentCommit:_commit,...gallery}=props;
 if(handles.length>64||new Set(handles.map(h=>h.id)).size!==handles.length||!Number.isFinite(canvasAspectRatio)||canvasAspectRatio<=0||canvasAspectRatio>10||handles.some(h=>!h.id.trim()||h.id.length>256||!h.label.trim()||![h.x,h.y,h.value,h.min,h.max].every(Number.isFinite)||h.x<0||h.x>1||h.y<0||h.y>1||h.min>=h.max||h.value<h.min||h.value>h.max||!['x','y'].includes(h.axis)))throw new RangeError('Invalid shape adjustment handles');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),selectedId,props.disabledReason,handles])]),guard=useScopedControl(owner,props,props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),active=handles.find(h=>h.id===s.activeId)??handles[0];
 useLayoutEffect(()=>{store.setState({preview:{}});},[owner]);
 const commit=(id:string,value:number|string|boolean)=>guard.run('adjustment',(h,signal)=>h.onAdjustmentCommit(id,value,signal));
 return <View style={{gap:12}}><AssetPresetGallery {...gallery} scope={scope} revision={revision} label="Vector shape presets" selectedIds={selectedId?[selectedId]:[]}/>{selectedId?<>
 <View style={{aspectRatio:canvasAspectRatio,position:'relative',overflow:'hidden',minHeight:88}} onLayout={e=>store.setState({width:e.nativeEvent.layout.width,height:e.nativeEvent.layout.height})}>
 {renderAdjustmentPreview(selectedId,Object.fromEntries(handles.map(h=>[h.id,s.preview[h.id]??h.value])))}
 {active?<ShapeHandle key={owner+active.id} handle={active} width={s.width} height={s.height} disabled={off} unstyled={props.unstyled??false} onPreview={value=>{if(guard.current())store.setState({preview:{[active.id]:value}});}} onCommit={value=>{store.setState({preview:{}});return commit(active.id,value);}} onCancel={()=>store.setState({preview:{}})}/>:null}
 </View>{handles.length?<Select label="Active shape adjustment handle" value={active?.id??''} options={handles.map(h=>({value:h.id,label:h.label}))} disabled={off} {...exact({unstyled:props.unstyled})} onValueChange={activeId=>{if(guard.current())store.setState({activeId,preview:{}});}}/>:null}
 <PropertyInspector scope={owner} disabledReason={off?'Shape editing unavailable':undefined} label="Shape adjustments" fields={adjustments} {...exact({unstyled:props.unstyled})} onCommit={commit}/>
 </>:null}<ErrorMessage {...exact({message:guard.error??props.disabledReason,unstyled:props.unstyled})}/></View>;
}
function ShapeHandle({handle:h,width,height,disabled,unstyled,onPreview,onCommit,onCancel}:{handle:ShapeAdjustmentHandle;width:number;height:number;disabled:boolean;unstyled:boolean;onPreview:(v:number)=>void;onCommit:(v:number)=>unknown;onCancel:()=>void}){
 const start=useRef<{value:number;width:number;height:number}|null>(null),value=(dx:number,dy:number)=>{const s=start.current;if(!s)return h.value;return Math.max(h.min,Math.min(h.max,s.value+(h.axis==='x'?dx/s.width:dy/s.height)*(h.max-h.min)));};
 const gesture=usePanGesture({enabled:!disabled&&width>=44&&height>=44,runOnJS:true,minDistance:4,maxPointers:1,onActivate:()=>{start.current={value:h.value,width,height};},onUpdate:e=>{if(start.current?.width===width&&start.current.height===height)onPreview(value(e.translationX,e.translationY));},onDeactivate:e=>{if(!e.canceled&&start.current?.width===width&&start.current.height===height)void onCommit(value(e.translationX,e.translationY));else onCancel();start.current=null;},onFinalize:e=>{if(e.canceled)onCancel();start.current=null;}});
 return <GestureDetector gesture={gesture} touchAction="none"><View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={h.label} accessibilityState={{disabled}} accessibilityValue={{min:h.min,max:h.max,now:h.value}} accessibilityActions={[{name:'increment'},{name:'decrement'}]} onAccessibilityAction={e=>{if(disabled)return;const d=e.nativeEvent.actionName==='increment'?1:e.nativeEvent.actionName==='decrement'?-1:0;if(d)void onCommit(Math.max(h.min,Math.min(h.max,h.value+d*(h.max-h.min)/100)));}} style={{position:'absolute',left:Math.max(0,Math.min(width-44,h.x*width-22)),top:Math.max(0,Math.min(height-44,h.y*height-22)),width:44,height:44,alignItems:'center',justifyContent:'center'}}><Text {...{className:unstyled?undefined:'text-accent'}} accessible={false}>◆</Text></View></GestureDetector>;
}
function makeStore(){return createStore(()=>({activeId:null as string|null,preview:{} as Record<string,number>,width:0,height:0}));}
