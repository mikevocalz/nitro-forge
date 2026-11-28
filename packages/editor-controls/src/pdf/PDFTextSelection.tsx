import type {ReactNode} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {validatePDFRect,type PDFRect} from './pdf-page-model.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface PDFTextSelectionProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 surface:ReactNode;pageId:string;selection:{text:string;start:number;end:number;rects:readonly PDFRect[];offsetUnit:'utf16'|'unicode-scalar'}|null;
 textLength:number;canCopy:boolean;copyRestriction?:string;scale:number;onCopy:(text:string,signal?:AbortSignal)=>unknown;
 onRangeCommit:(start:number,end:number,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Native PDF reading order and glyph rectangles are supplied by the renderer; Unicode offsets stay explicitly typed. */
export function PDFTextSelection({scope='pdf-selection',revision=0,...props}:PDFTextSelectionProps){
 const {surface,pageId,selection,textLength,canCopy,copyRestriction,scale,onCopy:_copy,onRangeCommit:_range,unstyled=false,disabledReason,style,...rest}=props;
 if(!pageId.trim()||pageId.length>256||!Number.isSafeInteger(textLength)||textLength<0||!Number.isFinite(scale)||scale<=0||scale>100||selection&&(selection.text.length>1048576||selection.rects.length>10000||![selection.start,selection.end].every(Number.isSafeInteger)||selection.start<0||selection.end<selection.start||selection.end>textLength||!['utf16','unicode-scalar'].includes(selection.offsetUnit)))throw new RangeError('Invalid PDF text selection');selection?.rects.forEach(validatePDFRect);
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),pageId,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} accessibilityLabel="PDF text selection" style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]}><View style={{position:'relative'}}>{surface}{selection?.rects.map((r,index)=><View key={index} pointerEvents="none" {...{className:unstyled?undefined:'bg-accent/20'}} style={{position:'absolute',left:r.x*scale,top:r.y*scale,width:r.width*scale,height:r.height*scale}}/>)}</View>
 <Text selectable={canCopy} {...{className:unstyled?undefined:'text-text'}}>{selection?.text??'Select text using the PDF renderer'}</Text><Button title="Copy selected PDF text" disabled={off||!canCopy||!selection?.text} accessibilityHint={copyRestriction} unstyled={unstyled} onPress={()=>guard.run('copy',(h,s)=>h.canCopy&&h.selection?h.onCopy(h.selection.text,s):undefined)}/>
 {selection&&textLength>0?<PropertyInspector scope={owner} label="Reading-order selection" disabledReason={off?'Selection editing unavailable':undefined} unstyled={unstyled} fields={[{id:'start',kind:'number',label:'Selection start ('+selection.offsetUnit+')',value:selection.start,min:0,max:textLength,step:1,integer:true},{id:'end',kind:'number',label:'Selection end ('+selection.offsetUnit+')',value:selection.end,min:0,max:textLength,step:1,integer:true}]} onCommit={(id,v)=>guard.run('range',(h,s)=>{if(!h.selection||typeof v!=='number')return;return h.onRangeCommit(id==='start'?v:Math.min(v,h.selection.start),id==='end'?v:Math.max(v,h.selection.end),s);})}/>:null}<ErrorMessage {...exact({message:guard.error??disabledReason??(!canCopy?copyRestriction:undefined),unstyled:unstyled})}/></View>;
}
