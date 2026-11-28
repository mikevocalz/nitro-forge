import type {ReactNode} from 'react';
import {FlatList,View} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface NamedTableStyle {name:string;styleId:string;header:boolean;totals:boolean;bandedRows:boolean;bandedColumns:boolean;structuredReferences:boolean}
export interface TableStyleGalleryProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {
 value:NamedTableStyle;styles:readonly {id:string;label:string}[];renderPreview:(styleId:string)=>ReactNode;onCommit:(value:NamedTableStyle,signal?:AbortSignal)=>unknown;
}
export function TableStyleGallery({value,styles,renderPreview,onCommit,...props}:TableStyleGalleryProps){
 if(styles.length>512||new Set(styles.map(s=>s.id)).size!==styles.length)throw new RangeError('Invalid table style catalog');
 const owner=JSON.stringify([...controlIdentity(props.scope??'table-style',props.revision??0),props.disabledReason]),guard=useScopedControl(owner,{value,onCommit,styles},props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 return <View style={{gap:tokens.spacing.fixedElement}}><PropertyInspector {...props} disabledReason={off?'Table style unavailable':undefined} label="Named table" fields={[
 {kind:'text',id:'name',label:'Table name',value:value.name,maxLength:256},...(['header','totals','bandedRows','bandedColumns','structuredReferences'] as const).map(id=>({kind:'boolean' as const,id,label:{header:'Header row',totals:'Totals row',bandedRows:'Banded rows',bandedColumns:'Banded columns',structuredReferences:'Structured references'}[id],value:value[id]}))
 ]} onCommit={(id,v)=>guard.run('table',(h,s)=>{const next={...h.value,[id]:v};if(!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(next.name))throw new Error('Use a table name beginning with a letter or underscore');return h.onCommit(next,s);})}/>
 <FlatList data={styles} keyExtractor={s=>s.id} initialNumToRender={4} windowSize={5} style={{height:controlTokens.extent.list}} extraData={[off,value.styleId]} renderItem={({item})=><View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.fixedElement}}><Button title={item.label} accessibilityState={{selected:item.id===value.styleId}} disabled={off} {...exact({unstyled:props.unstyled})} onPress={()=>guard.run('style',(h,s)=>h.styles.some(v=>v.id===item.id)?h.onCommit({...h.value,styleId:item.id},s):undefined)}/>{renderPreview(item.id)}</View>}/><ErrorMessage {...exact({message:guard.error??props.disabledReason,unstyled:props.unstyled})}/></View>;
}
