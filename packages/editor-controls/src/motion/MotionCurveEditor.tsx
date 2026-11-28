import {forgeRadius} from "../radius.ts";
import {useLayoutEffect,useRef} from 'react';
import {FlatList,Pressable,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {Button} from '@nyc-tron/ui/components/Button';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {useLocalPointer} from '@nyc-tron/ui/components/gestures/useLocalPointer';
import {keyboardKey,type KeyEventLike} from '@nyc-tron/ui/components/gestures/drag-transport';
import {CanvasKnob,LinePiece,type CanvasKeyEvent} from '../vector/vector-controls.tsx';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {MOTION_MAX_TIME,MOTION_TIME_EPSILON,validateMotionCurve,evaluateMotionCurve,sampleMotionCurve,motionSegmentControls,moveMotionKeys,setMotionHandle,setMotionInterpolation,insertMotionKey,removeMotionKeys,type MotionPropertyCurve,type MotionKeyframe,type MotionCurvePoint} from './motion-curves.ts';
export interface MotionCurveEditorProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly revision:string;readonly value:MotionPropertyCurve;readonly duration:number;readonly playhead:number;
 readonly viewRange:readonly [number,number];readonly onViewRangeChange:(range:readonly [number,number])=>void;
 readonly selectedId:string|null;readonly onSelect:(id:string|null)=>void;readonly createKeyId:()=>string;
 readonly onCommit:(curve:MotionPropertyCurve,selectedId:string|null)=>void;readonly onPreview?:(curve:MotionPropertyCurve|undefined)=>void;
 readonly mode?:'value'|'speed';readonly valueLabel?:string;readonly snapStep?:number;readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
type Target='key'|'in'|'out';
const PAD=24;
const makeStore=()=>createStore(()=>({width:0,preview:null as MotionPropertyCurve|null,error:null as string|null}));
/** Shared scalar editor for value, velocity and source-time curves. The host
 * retains keys/revision/selection; only a gesture preview lives here. */
export function MotionCurveEditor({scope,revision,value,duration,playhead,viewRange,onViewRangeChange,selectedId,onSelect,createKeyId,onCommit,onPreview,mode='value',valueLabel='Keyframe value',snapStep=0,height=220,disabled=false,unstyled=false,...props}:MotionCurveEditorProps){
 validateMotionCurve(value);
 if(!scope.trim()||!Number.isFinite(duration)||duration<=0||duration>MOTION_MAX_TIME||value.keys.some(key=>key.time>duration)||!viewRange.every(Number.isFinite)||viewRange[0]<0||viewRange[1]>duration||viewRange[1]-viewRange[0]<MOTION_TIME_EPSILON||!Number.isFinite(playhead)||playhead<0||playhead>duration||!Number.isFinite(snapStep)||snapStep<0||!Number.isFinite(height)||height<100||height>1000)throw new RangeError('Invalid motion graph scope, time range or viewport');
 const selected=value.keys.find(key=>key.id===selectedId);if(selectedId!==null&&!selected)throw new TypeError('Selected motion key is unavailable');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,state=>state);
 const latest=useRef({value,onPreview,onCommit,disabled,scope,revision});latest.current={value,onPreview,onCommit,disabled,scope,revision};
 const drag=useRef<{boundary:string;target:Target;start:MotionPropertyCurve;next:MotionPropertyCurve;keyId:string;moved:boolean}|null>(null);
 const pointerStart=useRef<{x:number;y:number}|null>(null);
 const boundary=JSON.stringify([scope,revision]);const committed=useRef<string|null>(null);
 const cancel=()=>{pointerStart.current=null;if(!drag.current)return;drag.current=null;store.setState({preview:null});latest.current.onPreview?.(undefined);};
 useLayoutEffect(()=>{committed.current=boundary;cancel();store.setState({error:null});return()=>{committed.current=null;cancel();};},[boundary,disabled,selectedId,viewRange[0],viewRange[1],height,s.width]);
 const shown=s.preview??value,width=Math.max(100,s.width||320),plotWidth=width-2*PAD,plotHeight=height-2*PAD,timeSpan=viewRange[1]-viewRange[0];
 const samples=sampleMotionCurve(shown,viewRange,128,mode==='speed');const speedExtent=Math.max(1,...samples.map(p=>p.value===null?0:Math.abs(p.value))),low=mode==='speed'?-speedExtent:value.minimum,high=mode==='speed'?speedExtent:value.maximum;
 const at=(point:MotionCurvePoint)=>({x:PAD+(point.time-viewRange[0])/timeSpan*plotWidth,y:PAD+(high-point.value)/(high-low)*plotHeight});
 const finiteSamples=samples.map(p=>({time:p.time,value:p.value,point:p.value===null?null:at({time:p.time,value:p.value})}));
 const current=shown.keys.find(key=>key.id===selectedId),index=shown.keys.findIndex(key=>key.id===selectedId),before=shown.keys[index-1],after=shown.keys[index+1];
 const incoming=current&&before?.interpolation==='bezier'?motionSegmentControls(before,current)[2]:null,outgoing=current?.interpolation==='bezier'&&after?motionSegmentControls(current,after)[1]:null;
 const select=(key:MotionKeyframe)=>{if(disabled)return;onSelect(key.id);if(key.time<viewRange[0]||key.time>viewRange[1]){const start=Math.max(0,Math.min(duration-timeSpan,key.time-timeSpan/2));onViewRangeChange([start,start+timeSpan]);}};
 const commit=(curve:MotionPropertyCurve,id=selectedId)=>{if(disabled||committed.current!==boundary)return;validateMotionCurve(curve);store.setState({error:null});if(JSON.stringify(curve)!==JSON.stringify(value))onCommit(curve,id);};
 const edit=(operation:()=>MotionPropertyCurve,id=selectedId)=>{try{commit(operation(),id);}catch(error){store.setState({error:error instanceof Error?error.message:'Invalid keyframe edit'});}};
 const begin=(target:Target)=>{if(disabled||!selectedId||committed.current!==boundary)return;if(drag.current){cancel();return;}drag.current={boundary,target,start:value,next:value,keyId:selectedId,moved:false};};
 const move=(dx:number,dy:number)=>{const active=drag.current;if(!active||active.boundary!==committed.current||disabled)return;if(!active.moved&&Math.hypot(dx,dy)<3)return;active.moved=true;const key=active.start.keys.find(key=>key.id===active.keyId)!;
  if(active.target==='key')active.next=moveMotionKeys(active.start,[key.id],dx/plotWidth*timeSpan,mode==='speed'?0:-dy/plotHeight*(high-low),duration,snapStep);
  else {const i=active.start.keys.findIndex(k=>k.id===key.id),neighbor=active.target==='in'?active.start.keys[i-1]:active.start.keys[i+1];if(!neighbor)return;const original=active.target==='in'?motionSegmentControls(neighbor,key)[2]:motionSegmentControls(key,neighbor)[1];active.next=setMotionHandle(active.start,key.id,active.target,{time:original.time+dx/plotWidth*timeSpan,value:original.value-dy/plotHeight*(high-low)});}
  store.setState({preview:active.next});latest.current.onPreview?.(active.next);
 };
 const release=()=>{const active=drag.current;drag.current=null;store.setState({preview:null});latest.current.onPreview?.(undefined);if(active?.moved&&active.boundary===committed.current&&!latest.current.disabled&&JSON.stringify(active.next)!==JSON.stringify(active.start))latest.current.onCommit(active.next,active.keyId);};
 const nudge=(target:Target,event:CanvasKeyEvent)=>{const key=keyboardKey(event);if(key==='Escape'){cancel();event.preventDefault?.();return;}const horizontal=key==='ArrowRight'?1:key==='ArrowLeft'?-1:0,vertical=key==='ArrowUp'?1:key==='ArrowDown'?-1:0;if(!horizontal&&!vertical||!selectedId||disabled)return;event.preventDefault?.();const factor=(event.shiftKey??event.nativeEvent?.shiftKey)?10:1,dt=horizontal*(snapStep||timeSpan/100)*factor,dv=vertical*(value.maximum-value.minimum)/100*factor;
  if(target==='key')edit(()=>moveMotionKeys(value,[selectedId],dt,mode==='speed'?0:dv,duration,horizontal?snapStep:0));else {const handle=target==='in'?incoming:outgoing;if(handle)edit(()=>setMotionHandle(value,selectedId,target,{time:handle.time+dt,value:handle.value+dv}));}
 };
 const surface=useLocalPointer({disabled,onBegin:point=>{pointerStart.current=point;},onMove:()=>{},onRelease:point=>{const start=pointerStart.current;pointerStart.current=null;if(!start||Math.hypot(point.x-start.x,point.y-start.y)>6||disabled)return;let nearest:MotionKeyframe|undefined,distance=Infinity;for(const key of value.keys){if(key.time<viewRange[0]||key.time>viewRange[1])continue;const p=at({time:key.time,value:mode==='speed'?0:key.value}),d=mode==='speed'?Math.abs(p.x-point.x):Math.hypot(p.x-point.x,p.y-point.y);if(d<distance){distance=d;nearest=key;}}if(nearest&&distance<=22)select(nearest);},onCancel:()=>{pointerStart.current=null;}});
 const keyPoint=current?at({time:current.time,value:mode==='speed'?low:current.value}):null;
 const visibleKeys=shown.keys.filter(key=>key.time>=viewRange[0]&&key.time<=viewRange[1]),stride=Math.max(1,Math.ceil(visibleKeys.length/256));
 const knob=(target:Target,point:MotionCurvePoint,label:string)=>{const p=at(point);if(point.time<viewRange[0]||point.time>viewRange[1])return null;return <CanvasKnob key={target} testID={`motion-${target}`} at={p} label={label} hint="Drag or use arrow keys. Escape cancels the gesture." selected={target==='key'} styled={!unstyled} actions={[{name:'increment',label:'Move forward'},{name:'decrement',label:'Move backward'}]} onAction={name=>nudge(target,{key:name==='increment'?'ArrowRight':'ArrowLeft'})} onKeyDown={event=>nudge(target,event)} onBegin={()=>begin(target)} onMove={(dx,dy)=>move(dx,dy)} onRelease={release} onCancel={cancel}><View pointerEvents="none" style={{width:10,height:10,borderWidth:2,borderRadius:target==='key'?0:forgeRadius.sm,transform:target==='key'?[{rotate:'45deg'}]:[]}} {...{className:joinClasses(!unstyled&&'bg-surface-raised border-accent')}}/></CanvasKnob>;};
 return <View {...props} style={[{gap:8},props.style]}>
  <Text accessibilityRole="header" {...{className:joinClasses(!unstyled&&'text-text')}}>{`${value.label}: ${mode==='speed'?'velocity per second':valueLabel}`}</Text>
  <View {...surface} onLayout={event=>{const width=event.nativeEvent.layout.width;if(width!==store.getState().width){cancel();store.setState({width});}}} {...{onKeyDown:(event:KeyEventLike)=>{if(keyboardKey(event)==='Escape')cancel();}}} style={{width:'100%',height,overflow:'hidden',direction:'ltr'}}>
   <View pointerEvents="none" style={{position:'absolute',inset:0}}>
    {finiteSamples.slice(1).map((sample,i)=>sample.point&&finiteSamples[i]!.point?<LinePiece key={i} from={finiteSamples[i]!.point!} to={sample.point} thickness={2} className={joinClasses(!unstyled&&'bg-accent')}/>:null)}
    {mode==='value'?visibleKeys.filter((key,i)=>i%stride===0||key.id===selectedId).map(key=>{const p=at(key);return <View key={key.id} style={{position:'absolute',left:p.x-3,top:p.y-3,width:6,height:6,transform:[{rotate:'45deg'}]}} {...{className:joinClasses(!unstyled&&'bg-text-muted')}}/>;}):null}
    {current&&mode==='value'&&incoming?<LinePiece from={at(current)} to={at(incoming)} thickness={1} className={joinClasses(!unstyled&&'bg-text-muted')}/>:null}
    {current&&mode==='value'&&outgoing?<LinePiece from={at(current)} to={at(outgoing)} thickness={1} className={joinClasses(!unstyled&&'bg-text-muted')}/>:null}
   </View>
   {!disabled&&current&&keyPoint?knob('key',{time:current.time,value:mode==='speed'?low:current.value},`Keyframe ${current.id}, time ${current.time}, ${mode==='speed'?'time handle':`value ${current.value}`}`):null}
   {!disabled&&mode==='value'&&incoming?knob('in',incoming,'Incoming Bezier handle'):null}{!disabled&&mode==='value'&&outgoing?knob('out',outgoing,'Outgoing Bezier handle'):null}
  </View>
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{`${viewRange[0]}–${viewRange[1]} seconds; ${mode==='speed'?'velocity':'value'} ${Number(low.toPrecision(5))}–${Number(high.toPrecision(5))}${mode==='speed'&&samples.some(p=>p.value===null)?'; gaps mark undefined velocity':''}`}</Text>
  <FlatList horizontal data={value.keys} keyExtractor={key=>key.id} initialNumToRender={12} windowSize={5} style={{height:48}} accessibilityLabel="Property keyframes" extraData={[selectedId,disabled]} renderItem={({item})=><Pressable accessibilityRole="radio" accessibilityLabel={`Select key ${item.id} at ${item.time} seconds`} accessibilityState={{checked:item.id===selectedId,disabled}} aria-checked={item.id===selectedId} disabled={disabled} onPress={()=>select(item)} style={{minHeight:44,minWidth:88,padding:8}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{`${item.time}s: ${item.value}`}</Text></Pressable>}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>
   <Button title="Add keyframe at playhead" disabled={disabled||value.keys.length>=10000} unstyled={unstyled} onPress={()=>{if(disabled)return;const existing=value.keys.find(key=>Math.abs(key.time-playhead)<MOTION_TIME_EPSILON);if(existing){select(existing);return;}const id=createKeyId();edit(()=>insertMotionKey(value,playhead,id),id);}}/>
   <Button title="Delete selected keyframe" disabled={disabled||!selectedId} unstyled={unstyled} onPress={()=>{if(selectedId)edit(()=>removeMotionKeys(value,[selectedId]),value.keys.find(key=>key.id!==selectedId)?.id??null);}}/>
  </View>
  {current?<>
   <UnitInput scope={scope} label="Keyframe time seconds" value={current.time} min={before?before.time+MOTION_TIME_EPSILON:0} max={after?after.time-MOTION_TIME_EPSILON:duration} step={snapStep||.01} precision={6} disabled={disabled} unstyled={unstyled} onCommit={time=>edit(()=>moveMotionKeys(value,[current.id],time-current.time,0,duration,snapStep))}/>
   <UnitInput scope={scope} label={valueLabel} value={current.value} min={value.minimum} max={value.maximum} step={(value.maximum-value.minimum)/100} precision={6} disabled={disabled} unstyled={unstyled} onCommit={number=>edit(()=>moveMotionKeys(value,[current.id],0,number-current.value,duration))}/>
   <Select label="Keyframe interpolation" value={current.interpolation} options={['hold','linear','bezier'].map(value=>({value,label:value}))} disabled={disabled} unstyled={unstyled} onValueChange={interpolation=>edit(()=>setMotionInterpolation(value,current.id,interpolation as MotionKeyframe['interpolation']))}/>
   {([['in',incoming,before],['out',outgoing,after]] as const).map(([side,handle,neighbor])=>{if(!handle||!neighbor)return null;const influence=Math.abs(handle.time-current.time),slope=influence===0?null:side==='in'?(current.value-handle.value)/influence:(handle.value-current.value)/influence;return <View key={side} style={{gap:6}}>
    <UnitInput scope={scope} label={`${side==='in'?'Incoming':'Outgoing'} influence seconds`} value={influence} min={0} max={Math.abs(neighbor.time-current.time)} step={.01} precision={6} disabled={disabled} unstyled={unstyled} onCommit={influence=>edit(()=>setMotionHandle(value,current.id,side,{time:current.time+(side==='in'?-influence:influence),value:handle.value}))}/>
    {slope!==null?<UnitInput scope={scope} label={`${side==='in'?'Incoming':'Outgoing'} velocity per second`} value={slope} min={side==='in'?(current.value-value.maximum)/influence:(value.minimum-current.value)/influence} max={side==='in'?(current.value-value.minimum)/influence:(value.maximum-current.value)/influence} step={.1} precision={6} disabled={disabled} unstyled={unstyled} onCommit={velocity=>edit(()=>setMotionHandle(value,current.id,side,{time:handle.time,value:current.value+(side==='in'?-1:1)*velocity*influence}))}/>:<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Handle slope is undefined at zero time influence</Text>}
   </View>;})}
  </>:<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Select a keyframe or add one at the playhead</Text>}
  <UnitInput scope={scope} label="Motion view start seconds" value={viewRange[0]} min={0} max={viewRange[1]-MOTION_TIME_EPSILON} precision={6} disabled={disabled} unstyled={unstyled} onCommit={start=>{if(!disabled)onViewRangeChange([start,viewRange[1]]);}}/>
  <UnitInput scope={scope} label="Motion view end seconds" value={viewRange[1]} min={viewRange[0]+MOTION_TIME_EPSILON} max={duration} precision={6} disabled={disabled} unstyled={unstyled} onCommit={end=>{if(!disabled)onViewRangeChange([viewRange[0],end]);}}/>
  {s.error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-danger')}}>{s.error}</Text>:null}
 </View>;
}
