import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface AutoLayoutSettings {direction:'row'|'column';gap:number;paddingTop:number;paddingRight:number;paddingBottom:number;paddingLeft:number;wrap:boolean;align:'start'|'center'|'end'|'stretch';justify:'start'|'center'|'end'|'space-between'}
export interface AutoLayoutInspectorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:AutoLayoutSettings;onCommit:(value:AutoLayoutSettings,signal?:AbortSignal)=>unknown}
export function AutoLayoutInspector({value,onCommit,...props}:AutoLayoutInspectorProps){return <PropertyInspector {...props} label="Auto layout" fields={[
 {kind:'choice',id:'direction',label:'Direction',value:value.direction,choices:['row','column'].map(id=>({id,label:id}))},
 ...(['gap','paddingTop','paddingRight','paddingBottom','paddingLeft'] as const).map(id=>({kind:'number' as const,id,label:id,value:value[id],min:0,max:100000,step:1,unit:'document units'})),
 {kind:'boolean',id:'wrap',label:'Wrap children',value:value.wrap},
 {kind:'choice',id:'align',label:'Cross-axis alignment',value:value.align,choices:['start','center','end','stretch'].map(id=>({id,label:id}))},
 {kind:'choice',id:'justify',label:'Main-axis distribution',value:value.justify,choices:['start','center','end','space-between'].map(id=>({id,label:id}))}
 ]} onCommit={(id,v,s)=>onCommit({...value,[id]:v},s)}/>;}
