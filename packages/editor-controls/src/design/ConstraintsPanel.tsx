import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface DesignConstraints {horizontal:'left'|'right'|'center'|'stretch'|'scale';vertical:'top'|'bottom'|'center'|'stretch'|'scale';minWidth:number;maxWidth:number;minHeight:number;maxHeight:number;aspectLocked:boolean;relativeToId:string}
export interface ConstraintsPanelProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:DesignConstraints;targets:readonly {id:string;label:string}[];onCommit:(value:DesignConstraints,signal?:AbortSignal)=>unknown}
function validate(v:DesignConstraints){if(v.minWidth>v.maxWidth||v.minHeight>v.maxHeight)throw new Error('Minimum size must not exceed maximum size');}
export function ConstraintsPanel({value,targets,onCommit,...props}:ConstraintsPanelProps){validate(value);return <PropertyInspector {...props} label="Responsive constraints" fields={[
 {kind:'choice',id:'horizontal',label:'Horizontal anchoring',value:value.horizontal,choices:['left','right','center','stretch','scale'].map(id=>({id,label:id}))},
 {kind:'choice',id:'vertical',label:'Vertical anchoring',value:value.vertical,choices:['top','bottom','center','stretch','scale'].map(id=>({id,label:id}))},
 ...(['minWidth','maxWidth','minHeight','maxHeight'] as const).map(id=>({kind:'number' as const,id,label:id,value:value[id],min:0,max:1000000,step:1})),
 {kind:'boolean',id:'aspectLocked',label:'Lock aspect ratio',value:value.aspectLocked},{kind:'choice',id:'relativeToId',label:'Relative to',value:value.relativeToId,choices:targets}
 ]} onCommit={(id,v,s)=>{const next={...value,[id]:v};validate(next);return onCommit(next,s);}}/>;}
