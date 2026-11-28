import type {ReactNode} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface MorphMatch {sourceId:string;targetId:string|null}
export interface MorphPreviewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sources:readonly {id:string;label:string}[];targets:readonly {id:string;label:string}[];matches:readonly MorphMatch[];
 progress:number;playing:boolean;durationMs:number;unavailableReason?:string;renderFrame:(progress:number,matches:readonly MorphMatch[])=>ReactNode;
 onMatchCommit:(matches:readonly MorphMatch[],signal?:AbortSignal)=>unknown;onScrub:(progress:number)=>void;onPlay:(signal?:AbortSignal)=>unknown;onStop:()=>void;unstyled?:boolean;
}
/** Correspondence editing and source-rendered morph frames; no second animation clock or substitute thumbnails. */
export function MorphPreview({scope='slide-morph',revision=0,...props}:MorphPreviewProps){
 const {sources,targets,matches,progress,playing,durationMs,unavailableReason,renderFrame,onMatchCommit:_match,onScrub:_scrub,onPlay:_play,onStop,unstyled=false,disabledReason,style,...rest}=props;
 if(sources.length>1024||targets.length>1024||matches.length>1024||new Set(sources.map(s=>s.id)).size!==sources.length||new Set(targets.map(t=>t.id)).size!==targets.length||new Set(matches.map(m=>m.sourceId)).size!==matches.length||new Set(matches.flatMap(m=>m.targetId===null?[]:[m.targetId])).size!==matches.filter(m=>m.targetId!==null).length||matches.some(m=>!sources.some(s=>s.id===m.sourceId)||m.targetId!==null&&!targets.some(t=>t.id===m.targetId))||!Number.isFinite(progress)||progress<0||progress>1||!Number.isFinite(durationMs)||durationMs<0||durationMs>600000)throw new RangeError('Invalid morph correspondence');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined||playing),off=guard.pending||disabledReason!==undefined||playing;
 return <View {...rest} accessibilityLabel="Slide morph preview" style={[{gap:tokens.spacing.fixedElement},style]}>{renderFrame(progress,matches)}<Text {...{className:unstyled?undefined:'text-text'}}>Morph {Math.round(progress*100)}% · {(durationMs/1000).toFixed(2)} s · {matches.filter(m=>m.targetId!==null).length} matched objects</Text>
 <PropertyInspector scope={owner} label="Morph position" disabledReason={off?'Morph scrub unavailable':undefined} unstyled={unstyled} fields={[{kind:'number',id:'progress',label:'Preview position',value:progress,min:0,max:1,step:.01}]} onCommit={(_id,v)=>{if(typeof v==='number')guard.current()?.onScrub(v);}}/>
 <FlatList data={sources} keyExtractor={s=>s.id} initialNumToRender={6} windowSize={5} style={{height:controlTokens.extent.list}} extraData={[off,matches]} renderItem={({item})=><Select label={'Morph target for '+item.label} value={matches.find(m=>m.sourceId===item.id)?.targetId===undefined||matches.find(m=>m.sourceId===item.id)?.targetId===null?'none':'target:'+matches.find(m=>m.sourceId===item.id)!.targetId} options={[{value:'none',label:'No matching object'},...targets.map(t=>({value:'target:'+t.id,label:t.label,disabled:matches.some(m=>m.sourceId!==item.id&&m.targetId===t.id)}))]} disabled={off} unstyled={unstyled} onValueChange={id=>guard.run('match',(h,s)=>{const targetId=id==='none'?null:id.slice(7);if(targetId!==null&&(!h.targets.some(t=>t.id===targetId)||h.matches.some(m=>m.sourceId!==item.id&&m.targetId===targetId)))throw new Error('Morph target already matched or unavailable');return h.onMatchCommit([...h.matches.filter(m=>m.sourceId!==item.id),{sourceId:item.id,targetId}],s);})}/>}/>
 <Button title="Play morph preview" disabled={off||unavailableReason!==undefined} unstyled={unstyled} onPress={()=>guard.run('play',(h,s)=>h.unavailableReason===undefined?h.onPlay(s):undefined)}/>{playing||guard.pendingId==='play'?<Button title="Stop morph preview" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onStop();}}/>:null}<ErrorMessage {...exact({message:guard.error??disabledReason??unavailableReason,unstyled:unstyled})}/></View>;
}
