import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface PrototypeInteraction {trigger:'tap'|'press'|'hover'|'drag'|'timer';delayMs:number;action:'navigate'|'overlay'|'back'|'close-overlay'|'set-variable';destinationId:string;transitionId:string;durationMs:number}
export interface InteractionTriggerEditorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:PrototypeInteraction;triggers:readonly PrototypeInteraction['trigger'][];destinations:readonly {id:string;label:string}[];transitions:readonly {id:string;label:string}[];onCommit:(value:PrototypeInteraction,signal?:AbortSignal)=>unknown}
export function InteractionTriggerEditor({value,triggers,destinations,transitions,onCommit,...props}:InteractionTriggerEditorProps){return <PropertyInspector {...props} label="Prototype interaction" fields={[
 {kind:'choice',id:'trigger',label:'Trigger',value:value.trigger,choices:triggers.map(id=>({id,label:id}))},
 ...(['timer','press','hover'].includes(value.trigger)?[{kind:'number' as const,id:'delayMs',label:'Trigger delay',value:value.delayMs,min:0,max:86400000,step:10,unit:'ms'}]:[]),
 {kind:'choice',id:'action',label:'Action',value:value.action,choices:['navigate','overlay','back','close-overlay','set-variable'].map(id=>({id,label:id}))},
 ...(['navigate','overlay','set-variable'].includes(value.action)?[{kind:'choice' as const,id:'destinationId',label:value.action==='set-variable'?'Variable action target':'Destination',value:value.destinationId,choices:destinations}]:[]),
 {kind:'choice',id:'transitionId',label:'Transition',value:value.transitionId,choices:transitions},{kind:'number',id:'durationMs',label:'Transition duration',value:value.durationMs,min:0,max:600000,step:10,unit:'ms'}
 ]} onCommit={(id,v,s)=>onCommit({...value,[id]:v},s)}/>;}
