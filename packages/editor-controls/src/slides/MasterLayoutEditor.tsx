import type {ReactNode} from 'react';
import {View,Text} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface MasterPlaceholder {id:string;label:string;kind:'title'|'body'|'image'|'media'|'date'|'footer'|'page-number';x:number;y:number;width:number;height:number;inheritTheme:boolean}
export interface MasterLayoutEditorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {
 layouts:readonly {id:string;label:string;parentId:string|null}[];layoutId:string;parentId:string|null;placeholderId:string|null;placeholders:readonly MasterPlaceholder[];
 renderCanvas:(layoutId:string)=>ReactNode;onLayoutChange:(id:string)=>void;onParentCommit:(parentId:string|null,signal?:AbortSignal)=>unknown;onPlaceholderCommit:(id:string,value:MasterPlaceholder,signal?:AbortSignal)=>unknown;
}
export function MasterLayoutEditor({layouts,layoutId,parentId,placeholderId,placeholders,renderCanvas,onLayoutChange,onParentCommit,onPlaceholderCommit,...props}:MasterLayoutEditorProps){
 if(layouts.length>512||placeholders.length>256||new Set(layouts.map(l=>l.id)).size!==layouts.length||new Set(placeholders.map(p=>p.id)).size!==placeholders.length||!layouts.some(l=>l.id===layoutId))throw new RangeError('Invalid master layout');
 const p=placeholders.find(p=>p.id===placeholderId);
 const parent=(next:string|null)=>{let at=next;const seen=new Set([layoutId]);while(at!==null){if(seen.has(at))throw new Error('Master layout inheritance cannot form a cycle');seen.add(at);const node=layouts.find(l=>l.id===at);if(!node)throw new Error('Parent layout is unavailable');at=node.parentId;}return next;};parent(parentId);
 return <View style={{gap:12}}><PropertyInspector {...props} label="Master layout" fields={[{id:'layout',kind:'choice',label:'Layout',value:layoutId,choices:layouts.map(l=>({id:l.id,label:l.label}))},{id:'parent',kind:'choice',label:'Parent master',value:parentId===null?'none':'layout:'+parentId,choices:[{id:'none',label:'No parent'},...layouts.filter(l=>l.id!==layoutId).map(l=>({id:'layout:'+l.id,label:l.label}))]}]} onCommit={(id,value,signal)=>id==='layout'?onLayoutChange(String(value)):onParentCommit(parent(value==='none'?null:String(value).slice(7)),signal)}/>{renderCanvas(layoutId)}
 {p?<PropertyInspector {...props} label={'Placeholder '+p.label} fields={[
 {kind:'choice',id:'kind',label:'Placeholder type',value:p.kind,choices:['title','body','image','media','date','footer','page-number'].map(id=>({id,label:id}))},
 ...(['x','y','width','height'] as const).map(id=>({kind:'number' as const,id,label:id,value:p[id],min:id==='width'||id==='height'?1:-14400,max:14400,step:1})),
 {kind:'boolean',id:'inheritTheme',label:'Inherit theme formatting',value:p.inheritTheme}
 ]} onCommit={(id,value,signal)=>onPlaceholderCommit(p.id,{...p,[id]:value},signal)}/>:<Text {...{className:props.unstyled?undefined:'text-text'}}>Select a placeholder on the master canvas</Text>}</View>;
}
