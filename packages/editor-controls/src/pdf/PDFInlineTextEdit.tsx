import {useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {GestureDetector,useTapGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {validatePDFRect,type PDFRect} from './pdf-page-model.ts';
export interface PDFTextRun {id:string;text:string;fontFamily:string;fontSize:number;rect:PDFRect;editable:boolean;limitation?:string}
export interface PDFInlineTextEditProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 pageId:string;surface:ReactNode;activeRun:PDFTextRun|null;layoutMode:'preserve-bounds'|'reflow-box';availableLayoutModes:readonly ('preserve-bounds'|'reflow-box')[];
 viewportToPage:(point:{x:number;y:number})=>{x:number;y:number};onHitTest:(point:{x:number;y:number},signal?:AbortSignal)=>unknown;
 validation:{text:string;valid:boolean;message?:string};status:'idle'|'saving'|'saved'|'error';lastSavedText:string|null;error?:string;
 onDraftChange:(runId:string,text:string)=>void;onLayoutModeChange:(mode:PDFInlineTextEditProps['layoutMode'])=>void;
 onSave:(runId:string,text:string,layoutMode:PDFInlineTextEditProps['layoutMode'],signal?:AbortSignal)=>unknown;onCancel:()=>void;unstyled?:boolean;
}
/** Actual native PDF hit tests/font admission and save acknowledgement; edits never claim an unacknowledged save. */
export function PDFInlineTextEdit({scope='pdf-inline-text',revision=0,...props}:PDFInlineTextEditProps){
 const {pageId,surface,activeRun,layoutMode,availableLayoutModes,viewportToPage:_point,onHitTest:_hit,validation,status,lastSavedText,error,onDraftChange:_draft,onLayoutModeChange:_mode,onSave:_save,onCancel,unstyled=false,disabledReason,style,...rest}=props;
 if(!pageId.trim()||pageId.length>256||activeRun&&(!activeRun.id.trim()||activeRun.id.length>256||activeRun.text.length>65536||activeRun.fontFamily.length>1024||!Number.isFinite(activeRun.fontSize)||activeRun.fontSize<=0||activeRun.fontSize>4096)||!['idle','saving','saved','error'].includes(status)||availableLayoutModes.some(m=>!['preserve-bounds','reflow-box'].includes(m)))throw new RangeError('Invalid PDF text edit');if(activeRun)validatePDFRect(activeRun.rect);
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),pageId,activeRun?.id,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined||status==='saving'),off=guard.pending||disabledReason!==undefined||status==='saving';
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(activeRun?.text??'');const store=local.current,draft=useStore(store,s=>s.draft);
 useLayoutEffect(()=>{store.setState({draft:activeRun?.text??''});},[owner,activeRun?.text]);
 const tap=useTapGesture({enabled:!off,runOnJS:true,maxDuration:300,maxDistance:8,onActivate:e=>guard.run('hit-test',(h,s)=>{const point=h.viewportToPage({x:e.x,y:e.y});if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('PDF coordinate transform unavailable');return h.onHitTest(point,s);})});
 const valid=validation.text===draft&&validation.valid,editable=activeRun?.editable===true;
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="PDF inline text editing"><GestureDetector gesture={tap}><View collapsable={false}>{surface}</View></GestureDetector>
 {activeRun?<><Text {...{className:unstyled?undefined:'text-text'}}>{activeRun.fontFamily} · {activeRun.fontSize} pt · {activeRun.rect.width} × {activeRun.rect.height} PDF units</Text><TextInput accessibilityLabel="Replacement PDF text" value={draft} multiline maxLength={65536} editable={!off&&editable} onChangeText={draft=>{const h=guard.current();if(h?.activeRun?.editable){store.setState({draft});h.onDraftChange(h.activeRun.id,draft);}}} style={{minHeight:88,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
 <Select label="PDF text layout policy" value={layoutMode} options={availableLayoutModes.map(value=>({value,label:value==='preserve-bounds'?'Keep existing text bounds':'Reflow inside text box'}))} disabled={off||!editable} unstyled={unstyled} onValueChange={value=>{const h=guard.current();if(h?.availableLayoutModes.includes(value as PDFInlineTextEditProps['layoutMode']))h.onLayoutModeChange(value as PDFInlineTextEditProps['layoutMode']);}}/>
 <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{status==='saving'?'Saving PDF text':status==='saved'&&lastSavedText===draft?'PDF save acknowledged':draft!==lastSavedText?'Edited text awaiting save':'No pending text changes'}</Text>
 <Button title="Save PDF text change" disabled={off||!editable||!valid||draft===lastSavedText||!availableLayoutModes.includes(layoutMode)} unstyled={unstyled} onPress={()=>guard.run('save',(h,s)=>{const text=store.getState().draft;if(!h.activeRun?.editable||h.validation.text!==text||!h.validation.valid||!h.availableLayoutModes.includes(h.layoutMode))throw new Error('PDF font or layout validation is not complete');return h.onSave(h.activeRun.id,text,h.layoutMode,s);})}/>
 <Button title="Cancel PDF text edit" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>
 <ErrorMessage message={activeRun.limitation??(validation.text===draft&&!validation.valid?validation.message:undefined)} unstyled={unstyled}/></>:<Text {...{className:unstyled?undefined:'text-text'}}>Tap a PDF text run to inspect editing support</Text>}
 <ErrorMessage message={guard.error??error??disabledReason} unstyled={unstyled}/></View>;
}
function makeStore(draft:string){return createStore(()=>({draft}));}
