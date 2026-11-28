import {View} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface TableCellLayout {rowSpan:number;columnSpan:number;horizontal:'start'|'center'|'end'|'justify';vertical:'top'|'middle'|'bottom';padding:number;borderWidth:number;borderStyle:'none'|'solid'|'dashed';borderColor:string;fill:string}
export interface TableLayoutInspectorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {
 value:TableCellLayout;colors:readonly {id:string;label:string}[];canMerge:boolean;canSplit:boolean;
 onCommit:(value:TableCellLayout,signal?:AbortSignal)=>unknown;onMerge:(signal?:AbortSignal)=>unknown;onSplit:(signal?:AbortSignal)=>unknown;
}
export function TableLayoutInspector({value,colors,canMerge,canSplit,onCommit,onMerge,onSplit,...props}:TableLayoutInspectorProps){
 const owner=JSON.stringify([...controlIdentity(props.scope??'table-layout',props.revision??0),props.disabledReason]),guard=useScopedControl(owner,{value,onCommit,onMerge,onSplit,canMerge,canSplit},props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 if(!Number.isInteger(value.rowSpan)||value.rowSpan<1||!Number.isInteger(value.columnSpan)||value.columnSpan<1)throw new RangeError('Invalid table cell span');
 return <View style={{gap:8}}><PropertyInspector {...props} disabledReason={off?'Table operation in progress':props.disabledReason} label="Table cell layout" fields={[
 {kind:'choice',id:'horizontal',label:'Cell horizontal alignment',value:value.horizontal,choices:['start','center','end','justify'].map(id=>({id,label:id}))},
 {kind:'choice',id:'vertical',label:'Cell vertical alignment',value:value.vertical,choices:['top','middle','bottom'].map(id=>({id,label:id}))},
 {kind:'number',id:'padding',label:'Cell padding',value:value.padding,min:0,max:1000,step:.5,unit:'pt'},
 {kind:'number',id:'borderWidth',label:'Border width',value:value.borderWidth,min:0,max:100,step:.1,unit:'pt'},
 {kind:'choice',id:'borderStyle',label:'Border style',value:value.borderStyle,choices:['none','solid','dashed'].map(id=>({id,label:id}))},
 {kind:'choice',id:'borderColor',label:'Border color',value:value.borderColor,choices:colors},
 {kind:'choice',id:'fill',label:'Cell fill',value:value.fill,choices:colors}
 ]} onCommit={(id,v)=>guard.run('layout',(h,s)=>h.onCommit({...h.value,[id]:v},s))}/>
 <Button title="Merge selected cells" disabled={off||!canMerge} {...exact({unstyled:props.unstyled})} onPress={()=>guard.run('merge',(h,s)=>h.canMerge?h.onMerge(s):undefined)}/><Button title={`Split ${value.rowSpan} by ${value.columnSpan} cell`} disabled={off||!canSplit} {...exact({unstyled:props.unstyled})} onPress={()=>guard.run('split',(h,s)=>h.canSplit?h.onSplit(s):undefined)}/><ErrorMessage {...exact({message:guard.error??props.disabledReason,unstyled:props.unstyled})}/></View>;
}
