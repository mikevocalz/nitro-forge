import {useLayoutEffect,useRef} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import {createStore,type StoreApi} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {MenuButton} from '@nyc-tron/ui/components/shell/MenuButton';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {assertFrameRate,formatTimecode,type FrameRate} from '../timebase.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface CaptionSegment {id:string;text:string;speakerId:string|null;startFrame:number;endFrame:number}
export interface AutoCaptionTranscriptTimelineProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 segments:readonly CaptionSegment[];speakers:readonly {id:string;label:string}[];frame:number;durationFrames:number;rate:FrameRate;selectedId:string|null;onSelect:(id:string)=>void;
 language:string;languages:readonly {id:string;label:string}[];onLanguageChange:(language:string)=>void;
 generation:{status:'idle'|'running'|'ready'|'error';progress?:number;error?:string;unavailableReason?:string};
 onGenerate:(language:string,signal?:AbortSignal)=>void|Promise<unknown>;onStop:()=>void;
 onEdit:(id:string,patch:{text?:string;speakerId?:string|null},signal?:AbortSignal)=>void|Promise<unknown>;
 onSeek:(frame:number,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Edits actual ASR caption blocks; the host owns recognition and playback clocks. */
export function AutoCaptionTranscriptTimeline({scope='auto-captions',revision=0,...props}:AutoCaptionTranscriptTimelineProps){
 const {segments,speakers,frame,durationFrames,rate,selectedId,onSelect:_select,language,languages,onLanguageChange:_language,generation,onGenerate:_generate,onStop,onEdit:_edit,onSeek:_seek,unstyled=false,disabledReason,style,...rest}=props;assertFrameRate(rate);
 if(!Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(durationFrames)||durationFrames<0||segments.length>50000||new Set(segments.map(s=>s.id)).size!==segments.length||segments.some(s=>!s.id.trim()||s.id.length>512||s.text.length>8192||!Number.isSafeInteger(s.startFrame)||!Number.isSafeInteger(s.endFrame)||s.startFrame<0||s.endFrame<=s.startFrame||s.endFrame>durationFrames)||speakers.length>256||languages.length>256||new Set(speakers.map(s=>s.id)).size!==speakers.length||new Set(languages.map(l=>l.id)).size!==languages.length||speakers.some(s=>!s.id.trim()||s.id.length>512||!s.label.trim()||s.label.length>1024)||languages.some(l=>!l.id.trim()||l.id.length>512||!l.label.trim()||l.label.length>1024)||!['idle','running','ready','error'].includes(generation.status)||generation.progress!==undefined&&(!Number.isFinite(generation.progress)||generation.progress<0||generation.progress>1))throw new RangeError('Invalid caption transcript');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||generation.status==='running'),off=guard.pending||disabledReason!==undefined||generation.status==='running';
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Caption transcript">
  <Select label="Caption language" value={language} options={languages.map(l=>({value:l.id,label:l.label}))} disabled={off} unstyled={unstyled} onValueChange={value=>guard.current()?.onLanguageChange(value)}/>
  <Button title="Generate captions from audio" disabled={off||generation.unavailableReason!==undefined||durationFrames===0||!languages.some(l=>l.id===language)} accessibilityHint={generation.unavailableReason} unstyled={unstyled} onPress={()=>guard.run('generate',(host,signal)=>host.languages.some(l=>l.id===host.language)?host.onGenerate(host.language,signal):undefined)}/>
  {generation.unavailableReason?<Text {...{className:unstyled?undefined:'text-text'}}>{generation.unavailableReason}</Text>:null}
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">Recognition: {generation.status}{generation.progress===undefined?'':`; ${(generation.progress*100).toFixed(0)}%`}</Text>
  {guard.pendingId==='generate'||generation.status==='running'?<Button title="Stop caption generation" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onStop();}}/>:null}
  <FlatList data={segments} keyExtractor={s=>s.id} initialNumToRender={8} windowSize={5} style={{height:controlTokens.extent.listTall}} keyboardShouldPersistTaps="handled" extraData={[frame,selectedId,off]} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>No caption blocks supplied</Text>}
   renderItem={({item})=><CaptionRow key={JSON.stringify([owner,item.id])} segment={item} speakers={speakers} scope={owner} active={frame>=item.startFrame&&frame<item.endFrame} selected={selectedId===item.id} disabled={off} rate={rate} unstyled={unstyled}
    onSelect={()=>guard.current()?.onSelect(item.id)} onSeek={()=>guard.run('seek',(host,signal)=>host.onSeek(item.startFrame,signal))}
    onEdit={patch=>guard.run('edit',(host,signal)=>host.segments.some(s=>s.id===item.id)&&(patch.speakerId===undefined||patch.speakerId===null||host.speakers.some(s=>s.id===patch.speakerId))?host.onEdit(item.id,patch,signal):undefined)}/>}/>
  <ErrorMessage {...exact({message:guard.error??generation.error??undefined,unstyled:unstyled})}/>
 </View>;
}
function CaptionRow({segment,speakers,scope,active,selected,disabled,rate,unstyled,onSelect,onSeek,onEdit}:{segment:CaptionSegment;speakers:readonly {id:string;label:string}[];scope:string;active:boolean;selected:boolean;disabled:boolean;rate:FrameRate;unstyled:boolean;onSelect:()=>void;onSeek:()=>void;onEdit:(patch:{text?:string;speakerId?:string|null})=>unknown}){
 const local=useRef<StoreApi<{text:string}>|null>(null);local.current??=createStore(()=>({text:segment.text}));const store=local.current,text=useStore(store,s=>s.text);
 useLayoutEffect(()=>{store.setState({text:segment.text});},[segment.text,segment.id]);
 return <View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.fixedElement}}>
  <Button title={`${formatTimecode(segment.startFrame,rate)}–${formatTimecode(segment.endFrame,rate)}${active?' · playing':''}`} accessibilityState={{selected}} variant="secondary" disabled={disabled} unstyled={unstyled} onPress={()=>{onSelect();onSeek();}}/>
  <MenuButton label={'Speaker for caption '+segment.id} editScope={JSON.stringify([scope,segment.id])} disabled={disabled} unstyled={unstyled} items={[{id:'none',label:'No speaker'},...speakers.map(s=>({id:'speaker:'+s.id,label:s.label}))]} onSelect={id=>onEdit({speakerId:id==='none'?null:id.slice(8)})}><Text {...{className:unstyled?undefined:'text-text'}}>{speakers.find(s=>s.id===segment.speakerId)?.label??'No speaker'}</Text></MenuButton>
  <TextInput accessibilityLabel={'Caption text '+segment.id} value={text} multiline maxLength={8192} editable={!disabled} onChangeText={text=>store.setState({text})} style={{minHeight:tokens.spacing.fixedTarget,padding:tokens.spacing.fixedElement}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
  <Button title="Apply caption text" disabled={disabled||text===segment.text} unstyled={unstyled} onPress={()=>onEdit({text})}/>
 </View>;
}
