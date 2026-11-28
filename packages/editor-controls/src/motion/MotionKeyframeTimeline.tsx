import {useLayoutEffect,useMemo,useRef} from 'react';
import {FlatList,Pressable,ScrollView,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {Button} from '@nyc-tron/ui/components/Button';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {keyboardKey,type KeyEventLike} from '@nyc-tron/ui/components/gestures/drag-transport';
import {CanvasKnob,type CanvasKeyEvent,type DragModifiers} from '../vector/vector-controls.tsx';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {assertFrameRate,type FrameRate} from '../timebase.ts';
import {removeMotionKeys,type MotionPropertyCurve,type MotionKeySelection} from './motion-curves.ts';
import {motionSelectionKey,validateMotionTimeline,moveMotionSelection} from './motion-timeline.ts';
import { tokens } from '../tokens.ts';
export type {MotionPropertyCurve,MotionKeyframe,MotionKeySelection} from './motion-curves.ts';
export interface MotionKeyframeTimelineProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly revision:string;readonly curves:readonly MotionPropertyCurve[];readonly duration:number;
 readonly selection:readonly MotionKeySelection[];readonly onSelectionChange:(selection:readonly MotionKeySelection[])=>void;
 readonly onCommit:(curves:readonly MotionPropertyCurve[],selection:readonly MotionKeySelection[])=>void;
 readonly onPreview?:(curves:readonly MotionPropertyCurve[]|undefined)=>void;
 readonly viewRange:readonly [number,number];readonly onViewRangeChange:(range:readonly [number,number])=>void;
 readonly playhead:number;readonly onPlayheadChange:(time:number)=>void;readonly frameRate:FrameRate;readonly snapToFrames:boolean;readonly onSnapChange:(enabled:boolean)=>void;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
const LABEL=100,PAD=24,ROW=84;
const signature=(selection:readonly MotionKeySelection[])=>JSON.stringify(selection.map(motionSelectionKey).sort());
const makeStore=()=>createStore(()=>({width:0,mode:'tracks' as 'tracks'|'keys'|'settings',preview:null as readonly MotionPropertyCurve[]|null,error:null as string|null}));
/** Virtualized property lanes and full key list share one controlled selection.
 * Shift adds and Ctrl/Meta toggles; dragging any selected key moves the group. */
export function MotionKeyframeTimeline({scope,revision,curves,duration,selection,onSelectionChange,onCommit,onPreview,viewRange,onViewRangeChange,playhead,onPlayheadChange,frameRate,snapToFrames,onSnapChange,height=320,disabled=false,unstyled=false,...props}:MotionKeyframeTimelineProps){
 validateMotionTimeline(curves,selection,duration);assertFrameRate(frameRate);
 if(!scope.trim()||!viewRange.every(Number.isFinite)||viewRange[0]<0||viewRange[1]>duration||viewRange[1]-viewRange[0]<.000001||!Number.isFinite(playhead)||playhead<0||playhead>duration||!Number.isFinite(height)||height<100||height>4000)throw new RangeError('Invalid keyframe timeline viewport or playhead');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,state=>state);
 const latest=useRef({onCommit,onPreview,disabled});latest.current={onCommit,onPreview,disabled};
 const boundary=JSON.stringify([scope,revision]),committed=useRef<string|null>(null);
 const drag=useRef<{boundary:string;start:readonly MotionPropertyCurve[];next:readonly MotionPropertyCurve[];selection:readonly MotionKeySelection[];anchor:MotionKeySelection;signature:string;moved:boolean}|null>(null);
 const cancel=()=>{if(!drag.current)return;drag.current=null;store.setState({preview:null});latest.current.onPreview?.(undefined);};
 useLayoutEffect(()=>{committed.current=boundary;cancel();store.setState({error:null});return()=>{committed.current=null;cancel();};},[boundary,disabled,viewRange[0],viewRange[1],s.width]);
 const selectedSignature=signature(selection);useLayoutEffect(()=>{if(drag.current&&drag.current.signature!==selectedSignature)cancel();},[selectedSignature]);
 const shown=s.preview??curves,chosen=new Set(selection.map(motionSelectionKey)),span=viewRange[1]-viewRange[0],stageWidth=Math.max(100,(s.width||420)-LABEL),plotWidth=Math.max(1,stageWidth-2*PAD),step=frameRate.denominator/frameRate.numerator;
 const rows=useMemo(()=>s.mode==='keys'?curves.flatMap(curve=>curve.keys.map(key=>({curve,key,ref:{propertyId:curve.id,keyId:key.id}}))):[],[curves,s.mode]);
 const setSelection=(next:readonly MotionKeySelection[])=>{if(disabled)return;onSelectionChange(next);};
 const selectAt=(ref:MotionKeySelection,mods:DragModifiers):readonly MotionKeySelection[]=>{const id=motionSelectionKey(ref),present=chosen.has(id);let next:readonly MotionKeySelection[];
  if(mods.ctrl||mods.meta)next=present?selection.filter(value=>motionSelectionKey(value)!==id):[...selection,ref];else if(mods.shift)next=present?selection:[...selection,ref];else next=present?selection:[ref];
  if(signature(next)!==selectedSignature)setSelection(next);return next;
 };
 const begin=(ref:MotionKeySelection,mods:DragModifiers)=>{if(disabled||committed.current!==boundary)return;if(drag.current){cancel();return;}const next=selectAt(ref,mods);if(!next.some(value=>motionSelectionKey(value)===motionSelectionKey(ref))){drag.current=null;return;}drag.current={boundary,start:curves,next:curves,selection:next,anchor:ref,signature:signature(next),moved:false};store.setState({error:null});};
 const move=(dx:number,dy:number,mods:DragModifiers)=>{const active=drag.current;if(!active||active.boundary!==committed.current||disabled)return;if(!active.moved&&Math.hypot(dx,dy)<3)return;active.moved=true;try{active.next=moveMotionSelection(active.start,active.selection,active.anchor,dx/plotWidth*span*(mods.alt?.1:1),duration,snapToFrames&&!mods.alt?step:0);store.setState({preview:active.next});latest.current.onPreview?.(active.next);}catch(error){cancel();store.setState({error:error instanceof Error?error.message:'Invalid keyframe group move'});}};
 const release=()=>{const active=drag.current;drag.current=null;store.setState({preview:null});latest.current.onPreview?.(undefined);if(active?.moved&&active.boundary===committed.current&&!latest.current.disabled&&JSON.stringify(active.next)!==JSON.stringify(active.start))latest.current.onCommit(active.next,active.selection);};
 const nudge=(ref:MotionKeySelection,direction:-1|1,factor=1,fine=false)=>{if(disabled||committed.current!==boundary)return;const next=chosen.has(motionSelectionKey(ref))?selection:[ref];try{const moved=moveMotionSelection(curves,next,ref,direction*(snapToFrames?step:span/100)*factor,duration,snapToFrames&&!fine?step:0);if(JSON.stringify(moved)!==JSON.stringify(curves))onCommit(moved,next);}catch(error){store.setState({error:error instanceof Error?error.message:'Invalid keyframe move'});}};
 const remove=()=>{if(disabled||!selection.length||committed.current!==boundary)return;const byProperty=new Map<string,string[]>();for(const ref of selection){const ids=byProperty.get(ref.propertyId)??[];ids.push(ref.keyId);byProperty.set(ref.propertyId,ids);}const next=curves.map(curve=>byProperty.has(curve.id)?removeMotionKeys(curve,byProperty.get(curve.id)!):curve);onCommit(next,[]);};
 const keyDown=(ref:MotionKeySelection,event:CanvasKeyEvent)=>{const key=keyboardKey(event);if(key==='Escape'){cancel();return;}if(key!=='ArrowLeft'&&key!=='ArrowRight')return;event.preventDefault?.();const alt=event.altKey??event.nativeEvent?.altKey??false,shift=event.shiftKey??event.nativeEvent?.shiftKey??false;nudge(ref,key==='ArrowRight'?1:-1,alt?.1:shift?10:1,alt);};
 const toggle=(ref:MotionKeySelection)=>setSelection(chosen.has(motionSelectionKey(ref))?selection.filter(value=>motionSelectionKey(value)!==motionSelectionKey(ref)):[...selection,ref]);
 const rootKey=(event:KeyEventLike)=>{const target=(event as {target?:{tagName?:string;isContentEditable?:boolean}}).target;if(target?.tagName==='INPUT'||target?.tagName==='TEXTAREA'||target?.isContentEditable)return;const key=keyboardKey(event);if(key==='Escape')cancel();else if(key==='Delete'||key==='Backspace'){(event as {preventDefault?:()=>void}).preventDefault?.();remove();}};
 return <View {...props} {...{onKeyDown:rootKey}} onLayout={event=>{const width=event.nativeEvent.layout.width;if(width!==store.getState().width){cancel();store.setState({width});}props.onLayout?.(event);}} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text')}}>{`${selection.length} selected keyframes`}</Text>
  <SegmentedControl aria-label="Keyframe timeline view" value={s.mode} options={[{value:'tracks',label:'Property lanes'},{value:'keys',label:'Key list'},{value:'settings',label:'Timing'}]} disabled={disabled} unstyled={unstyled} onChange={mode=>{cancel();store.setState({mode});}}/>
  {s.mode==='tracks'?<>
   <View pointerEvents="none" style={{flexDirection:'row',paddingLeft:LABEL+PAD,paddingRight:PAD,justifyContent:'space-between'}}>{Array.from({length:5},(_,i)=><Text key={i} {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{Number((viewRange[0]+span*i/4).toFixed(3))}</Text>)}</View>
   <FlatList data={shown} keyExtractor={curve=>curve.id} style={{height}} initialNumToRender={6} windowSize={5} getItemLayout={(_,index)=>({length:ROW,offset:ROW*index,index})} extraData={[selection,s.width,disabled,viewRange,playhead]} accessibilityLabel="Motion property lanes"
    ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No animated properties supplied</Text>}
    renderItem={({item:curve})=>{const visible=curve.keys.filter(key=>key.time>=viewRange[0]&&key.time<=viewRange[1]),stride=Math.max(1,Math.ceil(visible.length/Math.max(16,Math.min(128,Math.floor(plotWidth/8)))));const activeAnchor=drag.current?.anchor??selection[0];return <View style={{height:ROW,flexDirection:'row',borderBottomWidth:tokens.borderWidth.hairline}} {...{className:joinClasses(!unstyled&&'border-border')}}>
     <View style={{width:LABEL,justifyContent:'center',padding:tokens.spacing.fixedStack}}><Text numberOfLines={2} {...{className:joinClasses(!unstyled&&'text-text')}}>{curve.label}</Text><Button title="Select track" accessibilityLabel={`Select all ${curve.label} keyframes`} disabled={disabled||!curve.keys.length} unstyled={unstyled} onPress={()=>setSelection(curve.keys.map(key=>({propertyId:curve.id,keyId:key.id})))}/></View>
     <View style={{flex:1,height:ROW,position:'relative',overflow:'hidden',direction:'ltr'}}>
      {playhead>=viewRange[0]&&playhead<=viewRange[1]?<View pointerEvents="none" style={{position:'absolute',left:PAD+(playhead-viewRange[0])/span*plotWidth,width:tokens.borderWidth.hairline,top:0,bottom:0}} {...{className:joinClasses(!unstyled&&'bg-text-muted')}}/>:null}
      {visible.filter((key,i)=>i%stride===0||activeAnchor?.propertyId===curve.id&&activeAnchor.keyId===key.id).map(key=>{const ref={propertyId:curve.id,keyId:key.id},selected=chosen.has(motionSelectionKey(ref)),at={x:PAD+(key.time-viewRange[0])/span*plotWidth,y:ROW/2};return disabled?<View key={key.id} style={{position:'absolute',left:at.x-tokens.spacing.fixedStack,top:at.y-tokens.spacing.fixedStack,width:tokens.spacing.fixedElement,height:tokens.spacing.fixedElement}} {...{className:joinClasses(!unstyled&&'bg-text-muted')}}/>:<CanvasKnob key={key.id} at={at} selected={selected} styled={!unstyled} testID={`motion-key-${curve.id}-${key.id}`} label={`${curve.label} key ${key.id}, ${key.time} seconds`} hint="Drag selected keys together. Shift adds; Control or Command toggles. Arrow keys move the selection." actions={[{name:'activate',label:'Select key'},{name:'increment',label:'Move later'},{name:'decrement',label:'Move earlier'}]} onAction={name=>{if(name==='activate')setSelection([ref]);else if(name==='increment'||name==='decrement')nudge(ref,name==='increment'?1:-1);}} onKeyDown={event=>keyDown(ref,event)} onBegin={mods=>begin(ref,mods)} onMove={move} onRelease={release} onCancel={cancel}><View pointerEvents="none" style={{width:tokens.spacing.off10,height:tokens.spacing.off10,transform:[{rotate:'45deg'}]}} {...{className:joinClasses(!unstyled&&(selected?'bg-accent':'bg-text-muted'))}}/></CanvasKnob>;})}
     </View>
    </View>;}}/>
  </>:s.mode==='keys'?<FlatList data={rows} keyExtractor={row=>motionSelectionKey(row.ref)} style={{height}} initialNumToRender={12} windowSize={5} accessibilityLabel="All property keyframes" extraData={[selection,disabled]} renderItem={({item})=><Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.curve.label} key ${item.key.id}`} accessibilityState={{checked:chosen.has(motionSelectionKey(item.ref)),disabled}} aria-checked={chosen.has(motionSelectionKey(item.ref))} disabled={disabled} onPress={()=>toggle(item.ref)} style={{minHeight:tokens.spacing.off48,padding:tokens.spacing.fixedElement}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{`${item.curve.label}: ${item.key.time}s, ${item.key.value}`}</Text></Pressable>}/>:null}
  {s.mode==='settings'?<ScrollView style={{height}} contentContainerStyle={{gap:tokens.spacing.fixedElement}} keyboardShouldPersistTaps="handled">
  <SettingSwitch label="Snap motion keys to frames" on={snapToFrames} onChange={enabled=>{if(!disabled)onSnapChange(enabled);}} disabled={disabled} styled={!unstyled}/>
  <UnitInput scope={scope} label="Motion playhead seconds" value={playhead} min={0} max={duration} step={step} precision={6} disabled={disabled} unstyled={unstyled} onCommit={time=>{if(!disabled)onPlayheadChange(time);}}/>
  <UnitInput scope={scope} label="Timeline view start seconds" value={viewRange[0]} min={0} max={viewRange[1]-.000001} precision={6} disabled={disabled} unstyled={unstyled} onCommit={time=>{if(!disabled)onViewRangeChange([time,viewRange[1]]);}}/>
  <UnitInput scope={scope} label="Timeline view end seconds" value={viewRange[1]} min={viewRange[0]+.000001} max={duration} precision={6} disabled={disabled} unstyled={unstyled} onCommit={time=>{if(!disabled)onViewRangeChange([viewRange[0],time]);}}/>
  </ScrollView>:null}
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.off6}}><Button title="Delete selected motion keys" disabled={disabled||!selection.length} unstyled={unstyled} onPress={remove}/><Button title="Clear keyframe selection" disabled={disabled||!selection.length} unstyled={unstyled} onPress={()=>setSelection([])}/></View>
  {s.error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-danger')}}>{s.error}</Text>:null}
 </View>;
}
