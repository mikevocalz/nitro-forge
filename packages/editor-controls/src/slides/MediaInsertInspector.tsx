import type {ReactNode} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {InOutRangeHandles} from '../timeline/InOutRangeHandles.tsx';
import type {InOutRange} from '../timeline/edits.ts';
import type {FrameRate} from '../timebase.ts';
import {assertFrameRate} from '../timebase.ts';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
export interface SlideMediaSettings {fit:'contain'|'cover'|'stretch';autoplay:boolean;loop:boolean;muted:boolean;volume:number;showControls:boolean;hideWhenStopped:boolean}
export interface MediaInsertInspectorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 mediaId:string;kind:'video'|'audio';sourceLabel:string;surface:ReactNode;aspectRatio:number;settings:SlideMediaSettings;
 durationFrames:number;frame:number;rate:FrameRate;range:InOutRange;timelineWidth:number;status:'loading'|'ready'|'error';error?:string;
 onSettingsCommit:(value:SlideMediaSettings,signal?:AbortSignal)=>unknown;onRangeCommit:(range:InOutRange,signal?:AbortSignal)=>unknown;onReplace:(signal?:AbortSignal)=>unknown;onPreview:(signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function MediaInsertInspector({scope='slide-media',revision=0,...props}:MediaInsertInspectorProps){
 const {mediaId,kind,sourceLabel,surface,aspectRatio,settings,durationFrames,frame,rate,range,timelineWidth,status,error,onSettingsCommit:_settings,onRangeCommit:_range,onReplace:_replace,onPreview:_preview,unstyled=false,disabledReason,style,...rest}=props;assertFrameRate(rate);
 if(!mediaId.trim()||mediaId.length>256||!Number.isSafeInteger(durationFrames)||durationFrames<0||!Number.isSafeInteger(frame)||frame<0||!Number.isFinite(aspectRatio)||aspectRatio<=0||aspectRatio>10||!Number.isFinite(timelineWidth)||timelineWidth<44||timelineWidth>8192||range.inFrame!==undefined&&(!Number.isSafeInteger(range.inFrame)||range.inFrame<0||range.inFrame>durationFrames)||range.outFrame!==undefined&&(!Number.isSafeInteger(range.outFrame)||range.outFrame<0||range.outFrame>durationFrames)||range.inFrame!==undefined&&range.outFrame!==undefined&&range.inFrame>=range.outFrame||!['loading','ready','error'].includes(status))throw new RangeError('Invalid slide media');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),mediaId,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined||status!=='ready'),replace=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||replace.pending||disabledReason!==undefined||status!=='ready';
 return <View {...rest} accessibilityLabel="Slide media settings" style={[{gap:8},style]}><Text {...{className:unstyled?undefined:'text-text'}}>{kind}: {sourceLabel} · {status}</Text><View style={{aspectRatio,minHeight:88,overflow:'hidden'}}>{surface}</View>
 <PropertyInspector scope={owner} label="Media playback and fit" unstyled={unstyled} disabledReason={off?'Media editing unavailable':undefined} fields={[
 {kind:'choice',id:'fit',label:'Media fit',value:settings.fit,choices:['contain','cover','stretch'].map(id=>({id,label:id}))},
 ...(['autoplay','loop','muted','showControls','hideWhenStopped'] as const).map(id=>({kind:'boolean' as const,id,label:{autoplay:'Play automatically',loop:'Loop media',muted:'Mute media',showControls:'Show playback controls',hideWhenStopped:'Hide when stopped'}[id],value:settings[id]})),
 {kind:'number',id:'volume',label:'Media gain',value:settings.volume,min:0,max:1,step:.01}
 ]} onCommit={(id,v)=>guard.run('settings',(h,s)=>h.onSettingsCommit({...h.settings,[id]:v},s))}/>
 {durationFrames>0?<InOutRangeHandles scope={owner} revision={revision} viewport={{startFrame:0,pxPerFrame:timelineWidth/durationFrames,widthPx:timelineWidth}} rate={rate} durationFrames={durationFrames} playheadFrame={frame} range={range} disabled={off} unstyled={unstyled} onCommit={range=>guard.run('range',(h,s)=>h.onRangeCommit(range,s))}/>:null}
 <View style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}><Button title="Preview inserted media" disabled={off} unstyled={unstyled} onPress={()=>guard.run('preview',(h,s)=>h.onPreview(s))}/><Button title="Replace media source" disabled={replace.pending||guard.pending||disabledReason!==undefined} unstyled={unstyled} onPress={()=>replace.run('replace',(h,s)=>h.onReplace(s))}/></View><ErrorMessage {...exact({message:guard.error??replace.error??error??disabledReason,unstyled:unstyled})}/></View>;
}
