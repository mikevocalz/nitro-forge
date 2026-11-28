import {View,Text} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface CellFormat {numberFormat:'general'|'number'|'currency'|'percentage'|'date'|'time'|'custom';decimals:number;currency:string;locale:string;customPattern:string;horizontal:'start'|'center'|'end'|'justify';vertical:'top'|'middle'|'bottom';wrap:boolean;borderStyle:'none'|'solid'|'dashed';borderWidth:number;borderColor:string;fill:string;textColor:string}
export interface CellFormatInspectorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:CellFormat;colors:readonly {id:string;label:string}[];formattedPreview:string;onCommit:(value:CellFormat,signal?:AbortSignal)=>unknown}
export function CellFormatInspector({value,colors,formattedPreview,onCommit,...props}:CellFormatInspectorProps){return <View style={{gap:8}}><PropertyInspector {...props} label="Cell formatting" fields={[
 {kind:'choice',id:'numberFormat',label:'Number format',value:value.numberFormat,choices:['general','number','currency','percentage','date','time','custom'].map(id=>({id,label:id}))},
 {kind:'number',id:'decimals',label:'Decimal places',value:value.decimals,min:0,max:30,step:1,integer:true},
 {kind:'text',id:'currency',label:'ISO currency code',value:value.currency,maxLength:3},
 {kind:'text',id:'locale',label:'Formatting locale',value:value.locale,maxLength:64},
 {kind:'text',id:'customPattern',label:'Custom number/date pattern',value:value.customPattern,maxLength:256},
 {kind:'choice',id:'horizontal',label:'Horizontal alignment',value:value.horizontal,choices:['start','center','end','justify'].map(id=>({id,label:id}))},
 {kind:'choice',id:'vertical',label:'Vertical alignment',value:value.vertical,choices:['top','middle','bottom'].map(id=>({id,label:id}))},
 {kind:'boolean',id:'wrap',label:'Wrap cell text',value:value.wrap},
 {kind:'choice',id:'borderStyle',label:'Border style',value:value.borderStyle,choices:['none','solid','dashed'].map(id=>({id,label:id}))},
 {kind:'number',id:'borderWidth',label:'Border width',value:value.borderWidth,min:0,max:20,step:.5},
 ...(['borderColor','fill','textColor'] as const).map(id=>({kind:'choice' as const,id,label:{borderColor:'Border color',fill:'Cell fill',textColor:'Text color'}[id],value:value[id],choices:colors}))
 ]} onCommit={(id,v,s)=>{const next={...value,[id]:v};if(!/^[A-Z]{3}$/.test(next.currency))throw new Error('Use a three-letter uppercase currency code');return onCommit(next,s);}}/><Text {...{className:props.unstyled?undefined:'text-text'}}>Host formatted preview: {formattedPreview}</Text></View>;}
