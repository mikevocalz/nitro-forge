import {useLayoutEffect,useRef} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface SurroundPosition {x:number;y:number;z:number;spread:number}
export interface SurroundSpeaker {id:string;label:string;x:number;y:number;z:number}
export interface SurroundPanViewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:SurroundPosition;speakers:readonly SurroundSpeaker[];destinations:readonly string[];width:number;height:number;
 onPreview?:(position:SurroundPosition|undefined)=>void;
 onCommit:(position:SurroundPosition,signal?:AbortSignal)=>void|Promise<unknown>;
 onDestinationsChange:(ids:readonly string[],signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Speaker geometry and source positions come from the native routing engine, not inferred channel layouts. */
export function SurroundPanView({scope='surround-pan',revision=0,...props}:SurroundPanViewProps){
 const {value,speakers,destinations,width,height,onPreview:_preview,onCommit:_commit,onDestinationsChange:_routes,unstyled=false,disabledReason,style,...rest}=props;
 if(![value.x,value.y,value.z].every(n=>Number.isFinite(n)&&n>=-1&&n<=1)||!Number.isFinite(value.spread)||value.spread<0||value.spread>1||![width,height].every(n=>Number.isFinite(n)&&n>=100&&n<=2048)||speakers.length>64||new Set(speakers.map(s=>s.id)).size!==speakers.length||speakers.some(s=>!s.id.trim()||s.id.length>512||!s.label.trim()||s.label.length>1024||![s.x,s.y,s.z].every(n=>Number.isFinite(n)&&n>=-1&&n<=1))||destinations.length>64||new Set(destinations).size!==destinations.length)throw new RangeError('Invalid surround field');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason,width,height,speakers]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,preview=useStore(store,s=>s.preview),active=useRef(false);
 const cancel=()=>{active.current=false;store.setState({preview:null});guard.current()?.onPreview?.(undefined);};
 useLayoutEffect(()=>{cancel();return cancel;},[owner,value.x,value.y,value.z,value.spread,off]);
 const at=(x:number,y:number):SurroundPosition=>({...value,x:Math.min(1,Math.max(-1,x/width*2-1)),y:Math.min(1,Math.max(-1,1-y/height*2))});
 const move=(x:number,y:number)=>{if(!active.current||!guard.current())return;const next=at(x,y);store.setState({preview:next});guard.current()?.onPreview?.(next);};
 const commit=(next:SurroundPosition)=>guard.run('position',(host,signal)=>host.onCommit(next,signal));
 const gesture=usePanGesture({enabled:!off,runOnJS:true,minDistance:0,maxPointers:1,onActivate:event=>{if(!guard.current())return;active.current=true;move(event.x,event.y);},onUpdate:event=>move(event.x,event.y),onTouchesDown:event=>{if(event.numberOfTouches>1)cancel();},onTouchesCancel:cancel,onDeactivate:event=>{if(event.canceled){cancel();return;}if(!active.current)return;move(event.x,event.y);active.current=false;const next=store.getState().preview;store.setState({preview:null});guard.current()?.onPreview?.(undefined);if(next)void commit(next);}});
 const shown=preview??value;
 const key=(event:{key?:string;shiftKey?:boolean;preventDefault?:()=>void})=>{if(off)return;if(event.key==='Escape'){event.preventDefault?.();cancel();return;}const d=event.shiftKey ? .01 : .05;const delta=event.key==='ArrowLeft'?[-d,0]:event.key==='ArrowRight'?[d,0]:event.key==='ArrowUp'?[0,d]:event.key==='ArrowDown'?[0,-d]:null;if(!delta)return;event.preventDefault?.();void commit({...value,x:Math.max(-1,Math.min(1,value.x+delta[0]!)),y:Math.max(-1,Math.min(1,value.y+delta[1]!))});};
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Surround pan">
  <GestureDetector key={owner} gesture={gesture} touchAction="none" userSelect="none"><View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel="Surround source position" accessibilityValue={{text:`X ${shown.x.toFixed(2)}, Y ${shown.y.toFixed(2)}, Z ${shown.z.toFixed(2)}`}}
   accessibilityActions={[{name:'increment',label:'Move right'},{name:'decrement',label:'Move left'},{name:'up',label:'Move forward'},{name:'down',label:'Move back'}]} accessibilityState={{disabled:off}}
   onAccessibilityAction={e=>{const action=e.nativeEvent.actionName;key({key:action==='increment'?'ArrowRight':action==='decrement'?'ArrowLeft':action==='up'?'ArrowUp':action==='down'?'ArrowDown':''});}} {...{onKeyDown:key,focusable:!off,className:unstyled?undefined:'bg-surface-sunken border border-border rounded-control'}} style={{width,height,position:'relative',overflow:'hidden',direction:'ltr'}}>
   <View pointerEvents="none" {...{className:unstyled?undefined:'bg-border'}} style={{position:'absolute',left:width/2,top:0,bottom:0,width:1}}/><View pointerEvents="none" {...{className:unstyled?undefined:'bg-border'}} style={{position:'absolute',top:height/2,left:0,right:0,height:1}}/>
   {speakers.map(s=><Text key={s.id} pointerEvents="none" numberOfLines={1} {...{className:unstyled?undefined:'text-text-muted'}} style={{position:'absolute',left:Math.min(width-44,Math.max(0,(s.x+1)/2*width-22)),top:Math.min(height-24,Math.max(0,(1-s.y)/2*height-12)),width:44,textAlign:'center'}}>{s.label}</Text>)}
   <View pointerEvents="none" {...{className:unstyled?undefined:'bg-accent border border-border'}} style={{position:'absolute',left:(shown.x+1)/2*width-8,top:(1-shown.y)/2*height-8,width:16,height:16,borderRadius:8}}/>
  </View></GestureDetector>
  <PrecisionScrubber scope={scope} revision={revision} label="Source height Z" value={value.z} min={-1} max={1} step={.01} disabled={off} unstyled={unstyled} onCommit={z=>commit({...value,z})}/>
  <PrecisionScrubber scope={scope} revision={revision} label="Surround spread" value={value.spread} min={0} max={1} step={.01} disabled={off} unstyled={unstyled} onCommit={spread=>commit({...value,spread})}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{speakers.map(s=><Button key={s.id} title={'Route to '+s.label} accessibilityState={{checked:destinations.includes(s.id)}} disabled={off} unstyled={unstyled} onPress={()=>guard.run('route',(host,signal)=>{const ids=host.destinations.filter(id=>host.speakers.some(s=>s.id===id));return host.onDestinationsChange(ids.includes(s.id)?ids.filter(id=>id!==s.id):[...ids,s.id],signal);})}/>)}</View>
  <ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
function makeStore(){return createStore(()=>({preview:null as SurroundPosition|null}));}
