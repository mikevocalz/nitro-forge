import {EditorInteractionScope,useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {useLayoutEffect,useMemo,useRef} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {InOutRangeHandles} from './InOutRangeHandles.tsx';
import type {InOutRange} from './edits.ts';
import type {TimelineViewport} from './viewport.ts';
import type {FrameRate} from '../timebase.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface CaptionWord {id:string;text:string;startFrame:number;endFrame:number}
export interface CaptionWordTimingHandlesProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 words:readonly CaptionWord[];selectedId:string|null;onSelect:(id:string)=>void;durationFrames:number;frame:number;rate:FrameRate;viewport:TimelineViewport;
 onPreview?:(id:string,range:InOutRange|undefined)=>void;
 onCommit:(id:string,timing:{startFrame:number;endFrame:number},signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Frame-snapped word boundaries with neighboring-word collision checks. */
export function CaptionWordTimingHandles({scope='caption-word-timing',revision=0,...props}:CaptionWordTimingHandlesProps){
 const {words,selectedId,onSelect:_select,durationFrames,frame,rate,viewport,onPreview:_preview,onCommit:_commit,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(durationFrames)||durationFrames<0||words.length>10000||new Set(words.map(w=>w.id)).size!==words.length||words.some(w=>!w.id.trim()||w.id.length>512||w.text.length>512||!Number.isSafeInteger(w.startFrame)||!Number.isSafeInteger(w.endFrame)||w.startFrame<0||w.endFrame<=w.startFrame||w.endFrame>durationFrames))throw new RangeError('Invalid caption words');
 const sorted=[...words].sort((a,b)=>a.startFrame-b.startFrame),index=sorted.findIndex(w=>w.id===selectedId),word=sorted[index],low=sorted[index-1]?.endFrame??0,high=sorted[index+1]?.startFrame??durationFrames;
 const owner=JSON.stringify([...controlIdentity(scope,revision),selectedId,disabledReason]);
 const signature=useMemo(()=>JSON.stringify(words),[words]),boundary=useEditorBoundary([owner,signature,viewport.startFrame,viewport.pxPerFrame,viewport.widthPx]);
 const guard=useScopedControl(boundary,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,preview=useStore(store,s=>s.preview);
 useLayoutEffect(()=>{store.setState({preview:null});},[boundary]);
 const valid=(range:InOutRange)=>range.inFrame!==undefined&&range.outFrame!==undefined&&Number.isSafeInteger(range.inFrame)&&Number.isSafeInteger(range.outFrame)&&range.inFrame>=low&&range.outFrame<=high&&range.inFrame<range.outFrame;
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Caption word timing">
  <FlatList horizontal data={sorted} keyExtractor={w=>w.id} style={{maxHeight:80}} initialNumToRender={12} windowSize={5} renderItem={({item})=><Button title={item.text||'Empty word'} accessibilityLabel={`${item.text}, frames ${item.startFrame} to ${item.endFrame}`} accessibilityState={{selected:item.id===selectedId}} disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onSelect(item.id)}/>}/>
  {word?<>
   <Text {...{className:unstyled?undefined:'text-text'}}>{word.text}: {word.startFrame}–{word.endFrame}; available {low}–{high}</Text>
   <EditorInteractionScope.Provider value={boundary}><InOutRangeHandles key={owner} scope={scope} revision={revision} showCommands={false} viewport={viewport} rate={rate} durationFrames={durationFrames} playheadFrame={frame} range={{inFrame:word.startFrame,outFrame:word.endFrame}} disabled={off||low>=high} unstyled={unstyled}
    onPreview={range=>{const unchanged=range.inFrame===word.startFrame&&range.outFrame===word.endFrame;store.setState({preview:unchanged?null:range});guard.current()?.onPreview?.(word.id,unchanged?undefined:range);}}
    onCommit={range=>{store.setState({preview:null});guard.current()?.onPreview?.(word.id,undefined);return guard.run('timing',(host,signal)=>{if(!valid(range))throw new Error('Word timing must stay between its neighbors and contain at least one frame');return host.onCommit(word.id,{startFrame:range.inFrame!,endFrame:range.outFrame!},signal);});}}/></EditorInteractionScope.Provider>
   {preview&&!valid(preview)?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">Timing overlaps a neighboring word or has no duration</Text>:null}
   {low>=high?<Text {...{className:unstyled?undefined:'text-text'}}>Adjacent words leave no timing space. Adjust a neighboring word first.</Text>:null}
  </>:<Text {...{className:unstyled?undefined:'text-text'}}>Select a caption word to adjust its timing</Text>}
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
function makeStore(){return createStore(()=>({preview:null as InOutRange|null}));}
