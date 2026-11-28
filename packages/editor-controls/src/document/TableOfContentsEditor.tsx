import {View,FlatList,Text} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
export interface ContentsSettings {minimumLevel:number;maximumLevel:number;showPageNumbers:boolean;rightAlignNumbers:boolean;leader:'none'|'dots'|'dashes';hyperlinks:boolean}
export interface TableOfContentsEditorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {
 value:ContentsSettings;entries:readonly {id:string;label:string;level:number;pageLabel:string}[];stale:boolean;
 onCommit:(value:ContentsSettings,signal?:AbortSignal)=>unknown;onUpdate:(mode:'page-numbers'|'entire-table',signal?:AbortSignal)=>unknown;onJump:(id:string)=>void;
}
export function TableOfContentsEditor({value,entries,stale,onCommit,onUpdate,onJump,...props}:TableOfContentsEditorProps){
 if(value.minimumLevel>value.maximumLevel||entries.length>10000)throw new RangeError('Invalid contents hierarchy');
 const owner=JSON.stringify([...controlIdentity(props.scope??'table-of-contents',props.revision??0),props.disabledReason]),guard=useScopedControl(owner,{value,onCommit,onUpdate,onJump},props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 return <View style={{gap:8}}><PropertyInspector {...props} label="Table of contents" disabledReason={off?'Contents edit unavailable':undefined} fields={[
 ...(['minimumLevel','maximumLevel'] as const).map(id=>({kind:'number' as const,id,label:id==='minimumLevel'?'First heading level':'Last heading level',value:value[id],min:1,max:9,step:1,integer:true})),
 ...(['showPageNumbers','rightAlignNumbers','hyperlinks'] as const).map(id=>({kind:'boolean' as const,id,label:{showPageNumbers:'Page numbers',rightAlignNumbers:'Align numbers right',hyperlinks:'Create heading links'}[id],value:value[id]})),
 {kind:'choice',id:'leader',label:'Tab leader',value:value.leader,choices:['none','dots','dashes'].map(id=>({id,label:id}))}
 ]} onCommit={(id,v)=>guard.run('settings',(h,s)=>{const next={...h.value,[id]:v};if(next.minimumLevel>next.maximumLevel)throw new Error('Heading levels must be in ascending order');return h.onCommit(next,s);})}/><Text {...{className:props.unstyled?undefined:'text-text'}}>{stale?'Contents fields need updating':'Contents fields are current'}</Text>
 <View style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}>{(['page-numbers','entire-table'] as const).map(mode=><Button key={mode} title={'Update '+mode} disabled={off} unstyled={props.unstyled} onPress={()=>guard.run('update',(h,s)=>h.onUpdate(mode,s))}/>)}</View>
 <FlatList data={entries} keyExtractor={e=>e.id} style={{maxHeight:320}} initialNumToRender={8} windowSize={5} renderItem={({item})=><Button title={`${item.label} · ${item.pageLabel}`} style={{marginStart:Math.max(0,Math.min(9,item.level)-1)*8}} variant="secondary" disabled={off} unstyled={props.unstyled} onPress={()=>guard.current()?.onJump(item.id)}/>}/><ErrorMessage message={guard.error??props.disabledReason} unstyled={props.unstyled}/></View>;
}
