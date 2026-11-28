import {useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {validatePDFRect,type PDFRect} from './pdf-page-model.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface PDFRedactionMark {id:string;pageId:string;pageLabel:string;rects:readonly PDFRect[];reason:string}
export interface RedactionReviewToolProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 marks:readonly PDFRedactionMark[];planRevision:string|number;selectedId:string|null;preview:ReactNode;
 review:{status:'unreviewed'|'checking'|'ready'|'error';planRevision:string|number|null;message?:string};
 status:'idle'|'applying'|'applied'|'error';appliedCount:number;canApply:boolean;error?:string;
 onSelect:(id:string)=>void;onAddFromSelection:(signal?:AbortSignal)=>unknown;onRemoveMark:(id:string,signal?:AbortSignal)=>unknown;
 onReview:(signal?:AbortSignal)=>unknown;onApply:(ids:readonly string[],expectedPlanRevision:string|number,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function RedactionReviewTool({scope='pdf-redaction',revision=0,...props}:RedactionReviewToolProps){
 const {marks,planRevision,selectedId,preview,review,status,appliedCount,canApply,error,onSelect:_select,onAddFromSelection:_add,onRemoveMark:_remove,onReview:_review,onApply:_apply,unstyled=false,disabledReason,style,...rest}=props;
 if(marks.length>10000||new Set(marks.map(m=>m.id)).size!==marks.length||marks.reduce((n,m)=>n+m.rects.length,0)>65536||marks.some(m=>!m.id.trim()||m.id.length>256||!m.pageId.trim()||m.pageId.length>256||m.pageLabel.length>1024||m.reason.length>8192)||!Number.isSafeInteger(appliedCount)||appliedCount<0||typeof planRevision==='number'&&!Number.isFinite(planRevision)||typeof planRevision==='string'&&planRevision.length>512)throw new RangeError('Invalid redaction review plan');marks.forEach(m=>m.rects.forEach(validatePDFRect));
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),planRevision,marks,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined||status==='applying'||review.status==='checking'),off=guard.pending||disabledReason!==undefined||status==='applying'||review.status==='checking',ready=canApply&&marks.length>0&&review.status==='ready'&&review.planRevision===planRevision;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,confirm=useStore(store,s=>s.confirm);useLayoutEffect(()=>{store.setState({confirm:false});},[owner]);
 return <View {...rest} accessibilityLabel="PDF redaction review" style={[{gap:tokens.spacing.fixedElement},style]}>{preview}<Text {...{className:unstyled?undefined:'text-text'}}>Preview marks do not remove original content. Apply permanently removes the reviewed content through the PDF engine.</Text><Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{status==='applied'?`Host confirmed ${appliedCount} redactions applied`:status==='applying'?'Applying reviewed PDF redactions':`${marks.length} marks on ${new Set(marks.map(m=>m.pageId)).size} pages · review ${review.status}`}</Text>
 <FlatList data={marks} keyExtractor={m=>m.id} initialNumToRender={6} windowSize={5} style={{maxHeight:controlTokens.extent.list}} extraData={[selectedId,off]} renderItem={({item})=><View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.off6}}><Button title={item.pageLabel+' · '+(item.reason||'Redaction mark')} accessibilityState={{selected:item.id===selectedId}} variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onSelect(item.id)}/><Button title="Remove preview redaction mark" variant="ghost" disabled={off} unstyled={unstyled} onPress={()=>guard.run('remove',(h,s)=>h.marks.some(m=>m.id===item.id)?h.onRemoveMark(item.id,s):undefined)}/></View>}/>
 <View style={{flexDirection:'row',gap:tokens.spacing.off6,flexWrap:'wrap'}}><Button title="Mark selected PDF content for redaction" disabled={off} unstyled={unstyled} onPress={()=>guard.run('add',(h,s)=>h.onAddFromSelection(s))}/><Button title="Validate redaction plan" disabled={off||marks.length===0} unstyled={unstyled} onPress={()=>guard.run('review',(h,s)=>h.onReview(s))}/><Button title="Apply reviewed redactions" variant="danger" disabled={off||!ready} unstyled={unstyled} onPress={()=>store.setState({confirm:true})}/></View>
 {confirm?<View style={{gap:tokens.spacing.off6}}><Text accessibilityRole="header" {...{className:unstyled?undefined:'text-text'}}>Permanently apply {marks.length} redactions? This removes the reviewed content from the output PDF.</Text><Button title="Confirm permanent PDF redaction" variant="danger" disabled={off||!ready} unstyled={unstyled} onPress={()=>guard.run('apply',(h,s)=>{if(!h.canApply||h.review.status!=='ready'||h.review.planRevision!==h.planRevision||h.planRevision!==planRevision||!h.marks.length)throw new Error('The redaction plan changed; review it again');store.setState({confirm:false});return h.onApply(h.marks.map(m=>m.id),h.planRevision,s);})}/><Button title="Keep reviewing redaction marks" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>store.setState({confirm:false})}/></View>:null}
 <ErrorMessage {...exact({message:guard.error??error??review.message??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(){return createStore(()=>({confirm:false}));}
