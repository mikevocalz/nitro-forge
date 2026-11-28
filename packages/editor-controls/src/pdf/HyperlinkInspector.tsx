import {useRef,useLayoutEffect} from 'react';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {View} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
export interface PDFHyperlink {kind:'web'|'email'|'page';value:string;label:string;newWindow:boolean}
export interface HyperlinkInspectorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:PDFHyperlink;pages:readonly {id:string;label:string}[];onCommit:(value:PDFHyperlink,signal?:AbortSignal)=>unknown;onOpen:(value:PDFHyperlink,signal?:AbortSignal)=>unknown;onRemove:(signal?:AbortSignal)=>unknown}
function validate(value:PDFHyperlink,pages:HyperlinkInspectorProps['pages']){if(value.label.length>8192||value.value.length>8192)throw new Error('Link exceeds supported length');if(value.kind==='web'){let url:URL;try{url=new URL(value.value);}catch{throw new Error('Enter a complete HTTP or HTTPS link');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP or HTTPS link without embedded credentials');}else if(value.kind==='email'){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.value))throw new Error('Enter an email address');}else if(value.kind==='page'){if(!pages.some(p=>p.id===value.value))throw new Error('Select a page in this PDF');}else throw new Error('Unsupported PDF link action');}
export function HyperlinkInspector({value,pages,onCommit,onOpen,onRemove,...props}:HyperlinkInspectorProps){
 if(pages.length>100000)throw new RangeError('PDF link page list exceeds supported count');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(value);const store=local.current,draft=useStore(store,s=>s.value);
 const owner=JSON.stringify([...controlIdentity(props.scope??'pdf-link',props.revision??0),props.disabledReason]),guard=useScopedControl(owner,{value,pages,onCommit,onOpen,onRemove},props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 useLayoutEffect(()=>{store.setState({value});},[owner,value.kind,value.value,value.label,value.newWindow]);
 return <View style={{gap:8}}><PropertyInspector {...props} label="PDF hyperlink" disabledReason={off?'Link editing unavailable':undefined} fields={[
 {kind:'choice',id:'kind',label:'Link target type',value:draft.kind,choices:[{id:'web',label:'Web address'},{id:'email',label:'Email address'},{id:'page',label:'PDF page'}]},
 ...(draft.kind==='page'?(pages.length>1?[{kind:'number' as const,id:'pageNumber',label:'Destination page number',value:Math.max(1,pages.findIndex(p=>p.id===draft.value)+1),min:1,max:pages.length,step:1,integer:true}]:[]):[{kind:'text' as const,id:'value',label:draft.kind==='email'?'Email address':'Web URL',value:draft.value,maxLength:8192}]),
 {kind:'text',id:'label',label:'Link description',value:draft.label,maxLength:8192},{kind:'boolean',id:'newWindow',label:'Request separate viewer window',value:draft.newWindow}
 ]} onCommit={(id,v)=>{const next={...store.getState().value,[id]:v};if(id==='kind')next.value=v==='page'?(pages[0]?.id??''):'';if(id==='pageNumber'){next.value=pages[Number(v)-1]?.id??'';delete (next as PDFHyperlink&{pageNumber?:number}).pageNumber;}store.setState({value:next});}}/>
 <Button title="Apply PDF hyperlink" disabled={off} unstyled={props.unstyled} onPress={()=>guard.run('link',(h,s)=>{const current=store.getState().value;validate(current,h.pages);return h.onCommit(current,s);})}/>

 <Button title="Open PDF link target" disabled={off} unstyled={props.unstyled} onPress={()=>guard.run('open',(h,s)=>{const current=store.getState().value;validate(current,h.pages);return h.onOpen(current,s);})}/><Button title="Remove PDF hyperlink" variant="secondary" disabled={off} unstyled={props.unstyled} onPress={()=>guard.run('remove',(h,s)=>h.onRemove(s))}/><ErrorMessage message={guard.error??props.disabledReason} unstyled={props.unstyled}/></View>;
}

function makeStore(value:PDFHyperlink){return createStore(()=>({value}));}
