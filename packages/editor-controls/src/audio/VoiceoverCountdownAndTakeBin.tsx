import {useLayoutEffect,useRef} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {LiveRecordingWaveform,type LiveRecordingWaveformProps} from './LiveRecordingWaveform.tsx';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface VoiceoverTake {id:string;label:string;durationSamples:number;saved:boolean}
export interface VoiceoverCountdownAndTakeBinProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 status:'idle'|'countdown'|'recording'|'saving'|'error';countdownRemainingMs:number|null;
 permission:'unknown'|'granted'|'denied';input:LiveRecordingWaveformProps;takes:readonly VoiceoverTake[];selectedId:string|null;error?:string;
 onRequestPermission:(signal?:AbortSignal)=>unknown;onBeginCountdown:(signal?:AbortSignal)=>unknown;onCancelCountdown:()=>void;
 onStopAndSave:(signal?:AbortSignal)=>unknown;onSelect:(id:string)=>void;onAudition:(id:string,signal?:AbortSignal)=>unknown;
 onDiscard:(id:string,signal?:AbortSignal)=>unknown;onRetry:(signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Countdown follows native capture telemetry. Discard requires choosing a specific take and confirming it. */
export function VoiceoverCountdownAndTakeBin({scope='voiceover-takes',revision=0,...props}:VoiceoverCountdownAndTakeBinProps){
 const {status,countdownRemainingMs,permission,input,takes,selectedId,error,onRequestPermission:_permission,onBeginCountdown:_begin,onCancelCountdown,onStopAndSave:_stop,onSelect:_select,onAudition:_audition,onDiscard:_discard,onRetry:_retry,unstyled=false,disabledReason,style,...rest}=props;
 if(!['idle','countdown','recording','saving','error'].includes(status)||!['unknown','granted','denied'].includes(permission)||countdownRemainingMs!==null&&(!Number.isFinite(countdownRemainingMs)||countdownRemainingMs<0||countdownRemainingMs>600000)||takes.length>10000||new Set(takes.map(t=>t.id)).size!==takes.length||takes.some(t=>!t.id.trim()||t.id.length>512||!t.label.trim()||t.label.length>1024||!Number.isSafeInteger(t.durationSamples)||t.durationSamples<0))throw new RangeError('Invalid voiceover capture state');
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=JSON.stringify([identity,status,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||status==='recording'||status==='saving'||status==='countdown'),stop=useScopedControl(identity,props),off=guard.pending||disabledReason!==undefined||status==='recording'||status==='saving'||status==='countdown';
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,discardId=useStore(store,s=>s.discardId);
 useLayoutEffect(()=>{store.setState({discardId:null});},[identity,status]);
 const discard=takes.find(t=>t.id===discardId);
 return <View {...rest} accessibilityLabel="Voiceover recording and takes" style={[{gap:tokens.spacing.fixedElement},style]}>
  <Text accessibilityLiveRegion="assertive" {...{className:unstyled?undefined:'text-text'}}>{status==='countdown'?`Recording starts in ${countdownRemainingMs===null?'time not reported':Math.ceil(countdownRemainingMs/1000)+' seconds'}`:`Voiceover ${status}`}</Text>
  <LiveRecordingWaveform {...input} unstyled={unstyled}/>
  {permission!=='granted'?<Button title="Review microphone permission" disabled={off} unstyled={unstyled} onPress={()=>guard.run('permission',(h,s)=>h.onRequestPermission(s))}/>:null}
  <Button title="Start voiceover countdown" disabled={off||permission!=='granted'} unstyled={unstyled} onPress={()=>guard.run('begin',(h,s)=>h.permission==='granted'?h.onBeginCountdown(s):undefined)}/>
  {status==='countdown'||guard.pendingId==='begin'?<Button title="Cancel voiceover countdown" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancelCountdown();}}/>:null}
  {status==='recording'?<Button title="Stop and save voiceover take" disabled={stop.pending} unstyled={unstyled} onPress={()=>stop.run('save',(h,s)=>h.status==='recording'?h.onStopAndSave(s):undefined)}/>:null}
  <FlatList data={takes} keyExtractor={t=>t.id} style={{height:controlTokens.extent.list}} initialNumToRender={6} windowSize={5} extraData={[off,selectedId]} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>No voiceover takes supplied</Text>} renderItem={({item})=><View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.fixedElement}}><Button title={`${item.label} · ${(item.durationSamples/input.sampleRate).toFixed(2)} s · ${item.saved?'saved':'unsaved'}`} accessibilityState={{selected:item.id===selectedId}} disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onSelect(item.id)}/><View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.off6}}><Button title={'Audition '+item.label} disabled={off} unstyled={unstyled} onPress={()=>guard.run('audition',(h,s)=>h.takes.some(t=>t.id===item.id)?h.onAudition(item.id,s):undefined)}/><Button title={'Discard '+item.label} variant="danger" disabled={off} unstyled={unstyled} onPress={()=>store.setState({discardId:item.id})}/></View></View>}/>
  {discard?<View accessibilityLabel="Confirm take discard" style={{gap:tokens.spacing.off6}}><Text {...{className:unstyled?undefined:'text-text'}}>Discard {discard.label}? This removes the recorded take.</Text><Button title="Confirm discard take" variant="danger" disabled={off} unstyled={unstyled} onPress={()=>guard.run('discard',async(h,s)=>{if(!h.takes.some(t=>t.id===discard.id))return;await h.onDiscard(discard.id,s);store.setState({discardId:null});})}/><Button title="Keep take" variant="secondary" unstyled={unstyled} onPress={()=>store.setState({discardId:null})}/></View>:null}
  {status==='error'?<Button title="Retry voiceover recording" disabled={off} unstyled={unstyled} onPress={()=>guard.run('retry',(h,s)=>h.onRetry(s))}/>:null}
  <ErrorMessage {...exact({message:guard.error??stop.error??error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
function makeStore(){return createStore(()=>({discardId:null as string|null}));}
