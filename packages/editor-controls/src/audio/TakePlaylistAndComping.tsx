import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {useRef} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {WaveformLane,type WaveformLaneProps} from '../WaveformLane.tsx';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface AudioTake {id:string;label:string;lengthSamples:number;peaks:WaveformLaneProps['peaks'];muted:boolean}
export interface CompRegion {id:string;takeId:string;startSample:number;endSample:number}
export interface TakePlaylistAndCompingProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 takes:readonly AudioTake[];regions:readonly CompRegion[];durationSamples:number;
 selection:{startSample:number;endSample:number};selectedTakeId:string|null;recording:boolean;
 onSelectionChange:(range:{startSample:number;endSample:number})=>void;
 onSelectTake:(id:string)=>void;onAudition:(id:string,signal?:AbortSignal)=>unknown;
 onComp:(takeId:string,startSample:number,endSample:number,signal?:AbortSignal)=>unknown;
 onRemoveRegion:(id:string,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Swipe a take lane to request a comp range; host performs edits and crossfades transactionally. */
export function TakePlaylistAndComping({scope='take-comping',revision=0,...props}:TakePlaylistAndCompingProps){
 const {takes,regions,durationSamples,selection,selectedTakeId,recording,onSelectionChange:_range,onSelectTake:_select,onAudition:_audition,onComp:_comp,onRemoveRegion:_remove,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(durationSamples)||durationSamples<1||takes.length>256||new Set(takes.map(t=>t.id)).size!==takes.length||takes.some(t=>!t.id.trim()||t.id.length>512||!t.label.trim()||t.label.length>1024||!Number.isSafeInteger(t.lengthSamples)||t.lengthSamples<1||t.lengthSamples>durationSamples)||regions.length>10000||new Set(regions.map(r=>r.id)).size!==regions.length||regions.some(r=>!r.id.trim()||r.id.length>512||!takes.some(t=>t.id===r.takeId&&r.endSample<=t.lengthSamples)||!Number.isSafeInteger(r.startSample)||!Number.isSafeInteger(r.endSample)||r.startSample<0||r.endSample<=r.startSample)||!Number.isSafeInteger(selection.startSample)||!Number.isSafeInteger(selection.endSample)||selection.startSample<0||selection.endSample<=selection.startSample||selection.endSample>durationSamples)throw new RangeError('Invalid take comping data');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),durationSamples,takes.map(t=>[t.id,t.lengthSamples,t.muted]),recording,disabledReason])]),guard=useScopedControl(owner,props,recording||disabledReason!==undefined),off=guard.pending||recording||disabledReason!==undefined;
 const comp=(id:string,start=selection.startSample,end=selection.endSample)=>guard.run('comp',(h,s)=>h.takes.some(t=>t.id===id&&!t.muted&&end<=t.lengthSamples)&&start>=0&&end>start?h.onComp(id,start,end,s):undefined);
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="Take playlist and comping">
  <Text {...{className:unstyled?undefined:'text-text'}}>Swipe a take to comp a range, or set the range and choose Use selection.</Text>
  {([{key:'startSample',label:'Comp selection start',min:0,max:selection.endSample-1},{key:'endSample',label:'Comp selection end',min:selection.startSample+1,max:durationSamples}] as const).map(f=>f.max>f.min?<PrecisionScrubber key={f.key} scope={owner+f.key} label={f.label} value={selection[f.key]} min={f.min} max={f.max} step={1} unit="samples" disabled={off} unstyled={unstyled} onCommit={n=>guard.current()?.onSelectionChange({...selection,[f.key]:n})}/>:null)}
  <FlatList data={takes} keyExtractor={t=>t.id} style={{height:360}} initialNumToRender={4} windowSize={5} extraData={[off,selectedTakeId,selection]} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>No recorded takes supplied</Text>} renderItem={({item})=><TakeLane key={owner+item.id} take={item} disabled={off||item.muted} selected={selectedTakeId===item.id} scope={owner} unstyled={unstyled} onSwipe={(a,b)=>comp(item.id,a,b)} onSelect={()=>guard.current()?.onSelectTake(item.id)} onAudition={()=>guard.run('audition',(h,s)=>h.onAudition(item.id,s))} onComp={()=>comp(item.id)}/>}/>
  <FlatList data={regions} keyExtractor={r=>r.id} initialNumToRender={6} windowSize={5} style={{maxHeight:240}} renderItem={({item})=><View style={{flexDirection:'row',alignItems:'center',gap:8}}><Text style={{flex:1}} {...{className:unstyled?undefined:'text-text'}}>{takes.find(t=>t.id===item.takeId)?.label}: {item.startSample}–{item.endSample}</Text><Button title="Remove comp region" disabled={off} unstyled={unstyled} onPress={()=>guard.run('remove',(h,s)=>h.regions.some(r=>r.id===item.id)?h.onRemoveRegion(item.id,s):undefined)}/></View>}/>
  <ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
function TakeLane({take,disabled,selected,scope,unstyled,onSwipe,onSelect,onAudition,onComp}:{take:AudioTake;disabled:boolean;selected:boolean;scope:string;unstyled:boolean;onSwipe:(a:number,b:number)=>unknown;onSelect:()=>void;onAudition:()=>unknown;onComp:()=>unknown}){
 const width=useRef(0),start=useRef<{x:number;width:number}|null>(null),gesture=usePanGesture({enabled:!disabled,runOnJS:true,activeOffsetX:[-8,8],failOffsetY:[-8,8],maxPointers:1,onActivate:e=>{start.current={x:e.x-e.translationX,width:width.current};},onDeactivate:e=>{const x=start.current;start.current=null;if(e.canceled||x===null||x.width<=0||x.width!==width.current)return;const sample=(v:number)=>Math.round(Math.max(0,Math.min(1,v/x.width))*take.lengthSamples),a=sample(Math.min(x.x,e.x)),b=sample(Math.max(x.x,e.x));if(b>a)void onSwipe(a,b);},onFinalize:()=>{start.current=null;}});
 return <View style={{gap:6,paddingVertical:8}}><Button title={take.label+(take.muted?' · muted':'')} variant="secondary" accessibilityState={{selected}} disabled={disabled} unstyled={unstyled} onPress={onSelect}/><GestureDetector gesture={gesture} touchAction="pan-y"><View collapsable={false} onLayout={e=>{width.current=e.nativeEvent.layout.width;}}><WaveformLane scope={scope} peaks={take.peaks} unstyled={unstyled}/></View></GestureDetector><View style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}><Button title="Audition take" disabled={disabled} unstyled={unstyled} onPress={onAudition}/><Button title="Use selection" disabled={disabled} unstyled={unstyled} onPress={onComp}/></View></View>;
}
