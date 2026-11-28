import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture,usePinchGesture,useTapGesture,useSimultaneousGestures} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface ViewportCameraGesture {kind:'orbit'|'pan'|'zoom';phase:'begin'|'update'|'end'|'cancel';x:number;y:number;scale:number;viewport:{width:number;height:number}}
export interface Native3DViewportProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 surface:ReactNode;interaction:'orbit'|'pan'|'select';onInteractionChange:(mode:'orbit'|'pan'|'select')=>void;
 onCameraGesture:(event:ViewportCameraGesture)=>void;onPick:(point:{x:number;y:number},signal?:AbortSignal)=>unknown;
 materialModes:readonly {id:string;label:string}[];materialModeId:string;onMaterialModeChange:(id:string,signal?:AbortSignal)=>unknown;
 status:'loading'|'ready'|'error';error?:string;unstyled?:boolean;
}
/** Native gesture front end for an actual host 3D surface. Scene resources, ray casting and camera matrices remain native-engine owned. */
export function Native3DViewport({scope='3d-viewport',revision=0,...props}:Native3DViewportProps){const {surface,interaction,onInteractionChange:_mode,onCameraGesture:_camera,onPick:_pick,materialModes,materialModeId,onMaterialModeChange:_material,status,error,unstyled=false,disabledReason,style,...rest}=props;
 if(materialModes.length>64||new Set(materialModes.map(m=>m.id)).size!==materialModes.length||!['orbit','pan','select'].includes(interaction))throw new RangeError('Invalid 3D viewport configuration');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,v=useStore(store,s=>s),owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),interaction,disabledReason,status]),v.width,v.height]),guard=useScopedControl(owner,props,disabledReason!==undefined||status!=='ready'),off=guard.pending||disabledReason!==undefined||status!=='ready';
 const active=useRef(new Map<string,{send:Native3DViewportProps['onCameraGesture'];event:ViewportCameraGesture}>());
 const send=(kind:ViewportCameraGesture['kind'],phase:ViewportCameraGesture['phase'],x=0,y=0,scale=1)=>{if(phase==='begin'){const h=guard.current();if(!h)return;active.current.set(kind,{send:h.onCameraGesture,event:{kind,phase,x,y,scale,viewport:{width:v.width,height:v.height}}});}const a=active.current.get(kind);if(!a)return;const event={...a.event,phase,x,y,scale};a.event=event;if(phase==='end'||phase==='cancel')active.current.delete(kind);try{a.send(event);}catch{active.current.delete(kind);store.setState({error:'3D camera interaction failed'});}};
 useLayoutEffect(()=>{for(const a of active.current.values()){try{a.send({...a.event,phase:'cancel'});}catch{store.setState({error:'3D camera cancellation failed'});}}active.current.clear();},[owner]);useLayoutEffect(()=>()=>{for(const a of active.current.values()){try{a.send({...a.event,phase:'cancel'});}catch{}}active.current.clear();},[]);
 const pan=usePanGesture({enabled:!off&&interaction!=='select',runOnJS:true,minDistance:3,maxPointers:1,onActivate:()=>send(interaction==='pan'?'pan':'orbit','begin'),onUpdate:e=>send(interaction==='pan'?'pan':'orbit','update',e.translationX,e.translationY),onDeactivate:e=>send(interaction==='pan'?'pan':'orbit',e.canceled?'cancel':'end',e.translationX,e.translationY),onFinalize:e=>{if(e.canceled)send(interaction==='pan'?'pan':'orbit','cancel');}});
 const pinch=usePinchGesture({enabled:!off,runOnJS:true,onActivate:()=>send('zoom','begin'),onUpdate:e=>send('zoom','update',0,0,e.scale),onDeactivate:e=>send('zoom',e.canceled?'cancel':'end',0,0,e.scale),onFinalize:e=>{if(e.canceled)send('zoom','cancel');}});
 const tap=useTapGesture({enabled:!off&&interaction==='select',runOnJS:true,maxDistance:8,onDeactivate:e=>{if(!e.canceled&&v.width>0&&v.height>0)void guard.run('pick',(h,s)=>h.onPick({x:e.x,y:e.y},s));}}),gesture=useSimultaneousGestures(pan,pinch,tap);
 return <View {...rest} style={[{gap:8},style]}><Select label="3D interaction" value={interaction} options={['orbit','pan','select'].map(id=>({value:id,label:id}))} disabled={off} unstyled={unstyled} onValueChange={id=>guard.current()?.onInteractionChange(id as 'orbit'|'pan'|'select')}/><Select label="Material preview" value={materialModeId} options={materialModes.map(m=>({value:m.id,label:m.label}))} disabled={off} unstyled={unstyled} onValueChange={id=>guard.run('material',(h,s)=>h.materialModes.some(m=>m.id===id)?h.onMaterialModeChange(id,s):undefined)}/><GestureDetector gesture={gesture} touchAction="none"><View collapsable={false} style={{height:420,overflow:'hidden'}} onLayout={e=>{const {width,height}=e.nativeEvent.layout;if(width!==v.width||height!==v.height)store.setState({width,height});}}>{surface}</View></GestureDetector><Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{status}</Text><ErrorMessage {...exact({message:guard.error??v.error??error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(){return createStore(()=>({width:0,height:0,error:null as string|null}));}
