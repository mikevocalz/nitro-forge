import {useLayoutEffect,useRef} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface DictationSessionPanelProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 status:'idle'|'listening'|'processing'|'review'|'error';permission:'unknown'|'granted'|'denied';offline:boolean;supportsOffline:boolean;
 transcript:string;interimText:string;error?:string;canUndo:boolean;
 onRequestPermission:(signal?:AbortSignal)=>unknown;onStart:(signal?:AbortSignal)=>unknown;onStop:()=>void;
 onInsert:(text:string,signal?:AbortSignal)=>unknown;onDiscard:()=>void;onUndo:(signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Actual recognition events drive interim/final text; insertion is one host undo transaction. */
export function DictationSessionPanel({scope='dictation-session',revision=0,...props}:DictationSessionPanelProps){
 const {status,permission,offline,supportsOffline,transcript,interimText,error,canUndo,onRequestPermission:_permission,onStart:_start,onStop,onInsert:_insert,onDiscard,onUndo:_undo,unstyled=false,disabledReason,style,...rest}=props;
 if(!['idle','listening','processing','review','error'].includes(status)||!['unknown','granted','denied'].includes(permission)||transcript.length>65536||interimText.length>8192)throw new RangeError('Invalid dictation session');
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=JSON.stringify([identity,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||status==='listening'||status==='processing'),off=guard.pending||disabledReason!==undefined||status==='listening'||status==='processing';
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(transcript);const store=local.current,draft=useStore(store,s=>s.draft);
 useLayoutEffect(()=>{store.setState({draft:transcript});},[transcript,identity]);
 return <View {...rest} accessibilityLabel="Dictation session" style={[{gap:8},style]}><Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>Dictation {status}{offline?' · offline':''}</Text>
  {permission!=='granted'?<Button title="Review speech and microphone permission" disabled={off} unstyled={unstyled} onPress={()=>guard.run('permission',(h,s)=>h.onRequestPermission(s))}/>:null}
  <Button title="Start dictation" disabled={off||permission!=='granted'||offline&&!supportsOffline||status==='review'} unstyled={unstyled} onPress={()=>guard.run('start',(h,s)=>h.permission==='granted'&&(!h.offline||h.supportsOffline)?h.onStart(s):undefined)}/>
  {status==='listening'||status==='processing'||guard.pendingId==='start'?<Button title="Stop dictation" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onStop();}}/>:null}
  {interimText?<Text {...{className:unstyled?undefined:'text-text-muted'}}>Interim recognition: {interimText}</Text>:null}
  <TextInput accessibilityLabel="Review dictated text" value={draft} multiline editable={!off} maxLength={65536} onChangeText={draft=>store.setState({draft})} style={{minHeight:120,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
  <Button title="Insert reviewed dictation" disabled={off||status!=='review'||!draft.trim()} unstyled={unstyled} onPress={()=>guard.run('insert',(h,s)=>h.status==='review'?h.onInsert(store.getState().draft,s):undefined)}/>
  <Button title="Discard dictated draft" variant="secondary" disabled={off||status!=='review'} unstyled={unstyled} onPress={()=>{if(guard.current())onDiscard();}}/>
  <Button title="Undo inserted dictation" variant="secondary" disabled={off||!canUndo} unstyled={unstyled} onPress={()=>guard.run('undo',(h,s)=>h.canUndo?h.onUndo(s):undefined)}/>
  <ErrorMessage message={guard.error??error??disabledReason??(offline&&!supportsOffline?'Offline dictation is unavailable':undefined)} unstyled={unstyled}/>
 </View>;
}
function makeStore(draft:string){return createStore(()=>({draft}));}
