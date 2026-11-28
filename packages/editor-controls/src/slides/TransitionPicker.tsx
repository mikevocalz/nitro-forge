import type {ReactNode} from 'react';
import {View} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface SlideTransition {effectId:string;durationMs:number;advance:'manual'|'after';advanceAfterMs:number;easing:'linear'|'ease-in'|'ease-out'|'ease-in-out'}
export interface TransitionPickerProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {
 value:SlideTransition;effects:readonly {id:string;label:string;minDurationMs:number;maxDurationMs:number;unavailableReason?:string}[];
 previewProgress:number;renderPreview:(value:SlideTransition,progress:number)=>ReactNode;
 onCommit:(value:SlideTransition,signal?:AbortSignal)=>unknown;onPreview:(signal?:AbortSignal)=>unknown;
}
export function TransitionPicker({value,effects,previewProgress,renderPreview,onCommit,onPreview,...props}:TransitionPickerProps){
 if(effects.length>256||new Set(effects.map(e=>e.id)).size!==effects.length||effects.some(e=>!e.id.trim()||e.id.length>256||!e.label.trim()||![e.minDurationMs,e.maxDurationMs].every(Number.isFinite)||e.minDurationMs<0||e.maxDurationMs<e.minDurationMs||e.maxDurationMs>600000)||!Number.isFinite(previewProgress)||previewProgress<0||previewProgress>1)throw new RangeError('Invalid transition catalog');
 const effect=effects.find(e=>e.id===value.effectId),min=effect?.minDurationMs??0,max=effect?.maxDurationMs??600000,owner=JSON.stringify([...controlIdentity(props.scope??'slide-transition',props.revision??0),props.disabledReason]),guard=useScopedControl(owner,{value,effects,onCommit,onPreview},props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 return <View style={{gap:tokens.spacing.fixedElement}}><PropertyInspector {...props} disabledReason={off?'Transition edit unavailable':undefined} label="Slide transition" fields={[
 {kind:'choice',id:'effectId',label:'Transition effect',value:value.effectId,choices:effects.map(e=>({id:e.id,label:e.label,disabled:e.unavailableReason!==undefined}))},
 ...(max>min?[{kind:'number' as const,id:'durationMs',label:'Transition duration',value:value.durationMs,min,max,step:10,unit:'ms'}]:[]),
 {kind:'choice',id:'easing',label:'Transition easing',value:value.easing,choices:['linear','ease-in','ease-out','ease-in-out'].map(id=>({id,label:id}))},
 {kind:'choice',id:'advance',label:'Slide advance',value:value.advance,choices:[{id:'manual',label:'On command'},{id:'after',label:'After delay'}]},
 {kind:'number',id:'advanceAfterMs',label:'Automatic advance delay',value:value.advanceAfterMs,min:0,max:86400000,step:100,unit:'ms'}
 ]} onCommit={(id,v)=>guard.run('transition',(h,s)=>{const next={...h.value,[id]:v},e=h.effects.find(e=>e.id===next.effectId);if(!e||e.unavailableReason!==undefined)throw new Error('Transition effect unavailable');if(id==='effectId')next.durationMs=Math.max(e.minDurationMs,Math.min(e.maxDurationMs,next.durationMs));if(next.durationMs<e.minDurationMs||next.durationMs>e.maxDurationMs)throw new Error('Transition duration outside the supported range');return h.onCommit(next,s);})}/>{renderPreview(value,previewProgress)}<Button title="Preview slide transition" disabled={off||!effect||effect.unavailableReason!==undefined} {...exact({unstyled:props.unstyled})} onPress={()=>guard.run('preview',(h,s)=>h.onPreview(s))}/><ErrorMessage {...exact({message:guard.error??props.disabledReason??effect?.unavailableReason,unstyled:props.unstyled})}/></View>;
}
