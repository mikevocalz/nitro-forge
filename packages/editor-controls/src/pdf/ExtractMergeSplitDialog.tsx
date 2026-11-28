import {useRef,useLayoutEffect} from 'react';
import {Modal,Text,TextInput,View,FlatList} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {parsePDFPageRange} from './pdf-page-model.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface PDFSourceDocument {id:string;label:string;pageCount:number;unavailableReason?:string}
export interface ExtractMergeSplitDialogProps extends ScopedControlProps {
 open:boolean;mode:'extract'|'merge'|'split';sources:readonly PDFSourceDocument[];selectedSourceId:string|null;
 onChooseSources:(signal?:AbortSignal)=>unknown;onSelectSource:(id:string)=>void;
 onApply:(request:{mode:'extract'|'merge'|'split';sources:readonly string[];selectedSourceId:string;pages:readonly number[]},signal?:AbortSignal)=>unknown;onClose:()=>void;unstyled?:boolean;
}
/** Native modal review of source order and page selection; host retains file/security scopes and PDF transactions. */
export function ExtractMergeSplitDialog({scope='pdf-page-operation',revision=0,...props}:ExtractMergeSplitDialogProps){
 const {open,mode,sources,selectedSourceId,onChooseSources:_choose,onSelectSource:_select,onApply:_apply,onClose,unstyled=false,disabledReason}=props;
 if(sources.length>256||new Set(sources.map(s=>s.id)).size!==sources.length||sources.some(s=>!s.id.trim()||s.id.length>256||!s.label.trim()||s.label.length>1024||!Number.isSafeInteger(s.pageCount)||s.pageCount<1||s.pageCount>100000)||!['extract','merge','split'].includes(mode))throw new RangeError('Invalid PDF page operation');
 const owner=JSON.stringify([...controlIdentity(scope,revision),mode,open,disabledReason]),guard=useScopedControl(owner,props,!open||disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),source=sources.find(d=>d.id===selectedSourceId),order=s.order.length?s.order.filter(id=>sources.some(d=>d.id===id)).concat(sources.map(d=>d.id).filter(id=>!s.order.includes(id))):sources.map(d=>d.id);
 useLayoutEffect(()=>{store.setState({range:'1',order:[]});},[owner]);
 useLayoutEffect(()=>{store.setState({range:'1'});},[selectedSourceId]);
 const close=()=>{if(guard.cancel())onClose();};
 return <Modal visible={open} transparent animationType="none" onRequestClose={close}><View style={{flex:1,justifyContent:'center',padding:tokens.spacing.fixedGroup}} {...{className:unstyled?undefined:'bg-text/25'}}><View accessibilityViewIsModal accessibilityLabel={mode+' PDF pages'} style={{gap:tokens.spacing.fixedElement,padding:tokens.spacing.fixedGroup,maxHeight:'90%'}} {...{className:unstyled?undefined:'bg-surface-raised border border-border rounded-control'}}><Text accessibilityRole="header" {...{className:unstyled?undefined:'text-text'}}>{mode==='merge'?'Merge PDF sources':mode==='extract'?'Extract PDF pages':'Split PDF pages'}</Text><Button title="Choose PDF source documents" disabled={off} unstyled={unstyled} onPress={()=>guard.run('choose',(h,s)=>h.onChooseSources(s))}/>
 <FlatList data={order} keyExtractor={id=>id} initialNumToRender={5} windowSize={5} style={{maxHeight:controlTokens.extent.preview}} extraData={[sources,selectedSourceId,off]} renderItem={({item,index})=>{const d=sources.find(s=>s.id===item)!;return <View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.off6}}><Button title={`${index+1}. ${d.label} · ${d.pageCount} pages`} accessibilityState={{selected:d.id===selectedSourceId}} disabled={off||d.unavailableReason!==undefined} accessibilityHint={d.unavailableReason} unstyled={unstyled} onPress={()=>guard.current()?.onSelectSource(d.id)}/>{mode==='merge'?<Button title="Move source earlier" variant="secondary" disabled={off||index===0} unstyled={unstyled} onPress={()=>{const next=[...order];[next[index-1],next[index]]=[next[index]!,next[index-1]!];store.setState({order:next});}}/>:null}</View>;}}/>
 {mode!=='merge'?<><Text {...{className:unstyled?undefined:'text-text'}}>Pages from {source?.label??'selected source'} (for example 1-3, 8)</Text><TextInput accessibilityLabel="PDF page ranges" value={s.range} maxLength={8192} editable={!off} onChangeText={range=>store.setState({range})} style={{minHeight:tokens.spacing.fixedTarget,padding:tokens.spacing.fixedElement}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/></>:null}
 <Button title={mode==='merge'?'Merge reviewed source order':mode==='extract'?'Extract reviewed pages':'Split reviewed pages'} disabled={off||(mode==='merge'?sources.length<2||sources.some(s=>s.unavailableReason!==undefined):!source||source.unavailableReason!==undefined)} unstyled={unstyled} onPress={()=>guard.run('apply',(h,signal)=>{const selected=h.sources.find(d=>d.id===h.selectedSourceId)??(h.mode==='merge'?h.sources[0]:undefined);if(!selected)throw new Error('Select a PDF source');if(selected.unavailableReason!==undefined||h.mode==='merge'&&order.some(id=>!h.sources.some(d=>d.id===id&&d.unavailableReason===undefined)))throw new Error('PDF source availability changed');return h.onApply({mode:h.mode,sources:h.mode==='merge'?order:[selected.id],selectedSourceId:selected.id,pages:h.mode==='merge'?[]:parsePDFPageRange(store.getState().range,selected.pageCount)},signal);})}/><Button title="Cancel PDF page operation" variant="secondary" unstyled={unstyled} onPress={close}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View></View></Modal>;
}
function makeStore(){return createStore(()=>({range:'1',order:[] as string[]}));}
