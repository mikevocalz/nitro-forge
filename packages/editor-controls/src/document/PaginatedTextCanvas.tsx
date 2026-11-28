import type {ReactNode} from 'react';
import {ScrollView,Text,View,type ViewProps} from 'react-native';
import {TextSelectionAndCaret,type DocumentTextSelection} from './TextSelectionAndCaret.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface TextCanvasPage {id:string;label:string;width:number;height:number;marginTop:number;marginBottom:number;marginLeft:number;marginRight:number;text:string;contentRevision:string|number;oversetCharacters:number}
export interface PageEditorContext {readOnly:boolean;selection:DocumentTextSelection;onTextChange:(text:string)=>void;onSelectionChange:(selection:DocumentTextSelection)=>void;onFocus:()=>void;onMeasuredContent:(size:{width:number;height:number})=>void}
type PageEditorBackend={mode:'plain-text';renderRichEditor?:never}|{mode:'native-rich-text';renderRichEditor:(page:TextCanvasPage,context:PageEditorContext)=>ReactNode};
export type PaginatedTextCanvasProps=Omit<ViewProps,'children'>&ScopedControlProps&PageEditorBackend&{
 pages:readonly TextCanvasPage[];activePageId:string|null;selection:DocumentTextSelection;zoom:number;readOnly?:boolean;
 onActivatePage:(id:string)=>void;onPageTextChange:(id:string,text:string)=>void;onSelectionChange:(id:string,selection:DocumentTextSelection)=>void;
 onMeasuredContent:(pageId:string,size:{width:number;height:number;availableHeight:number})=>void;unstyled?:boolean;
};
/** Host-layout pages with actual native plain text inputs or an explicit native rich-text adapter. */
export function PaginatedTextCanvas({scope='paginated-text',revision=0,...props}:PaginatedTextCanvasProps){
 const {pages,activePageId,selection,zoom,readOnly=false,onActivatePage:_activate,onPageTextChange:_text,onSelectionChange:_selection,onMeasuredContent:_measure,mode,renderRichEditor,unstyled=false,disabledReason,style,...rest}=props;
 if(pages.length>512||pages.reduce((total,p)=>total+p.text.length,0)>16777216||new Set(pages.map(p=>p.id)).size!==pages.length||!Number.isFinite(zoom)||zoom<.1||zoom>4||pages.some(p=>!p.id.trim()||p.id.length>256||!p.label.trim()||p.label.length>1024||p.text.length>1048576||![p.width,p.height,p.marginTop,p.marginBottom,p.marginLeft,p.marginRight].every(Number.isFinite)||p.width<36||p.height<36||p.width>14400||p.height>14400||[p.marginTop,p.marginBottom,p.marginLeft,p.marginRight].some(n=>n<0)||p.marginLeft+p.marginRight>=p.width||p.marginTop+p.marginBottom>=p.height||!Number.isSafeInteger(p.oversetCharacters)||p.oversetCharacters<0)||!['plain-text','native-rich-text'].includes(mode))throw new RangeError('Invalid paginated text layout');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=readOnly||disabledReason!==undefined;
 return <View {...rest} style={[{minWidth:0,minHeight:0},style]} accessibilityLabel="Paginated document">
 <Text {...{className:unstyled?undefined:'text-text-muted'}}>{pages.length} laid-out pages · {mode==='plain-text'?'Native plain text editing':'Host native rich text editing'}</Text>
 <ScrollView horizontal nestedScrollEnabled><ScrollView nestedScrollEnabled style={{maxHeight:tokens.spacing.off800}} contentContainerStyle={{gap:tokens.spacing.fixedGroup,padding:tokens.spacing.fixedElement}} keyboardShouldPersistTaps="handled">
 {pages.map(page=>{const active=page.id===activePageId,context:PageEditorContext={readOnly:off,selection:active?selection:{start:0,end:0},onTextChange:text=>{const h=guard.current();if(h&&!h.readOnly)h.onPageTextChange(page.id,text);},onSelectionChange:value=>guard.current()?.onSelectionChange(page.id,value),onFocus:()=>guard.current()?.onActivatePage(page.id),onMeasuredContent:size=>guard.current()?.onMeasuredContent(page.id,{...size,availableHeight:page.height-page.marginTop-page.marginBottom})};
 return <View key={page.id} style={{width:page.width*zoom,height:page.height*zoom,overflow:'hidden'}} accessibilityLabel={page.label}>
  <View {...{className:unstyled?undefined:'bg-surface-raised border border-border'}} style={{width:page.width,height:page.height,transformOrigin:'top left',transform:[{scale:zoom}],paddingTop:page.marginTop,paddingBottom:page.marginBottom,paddingLeft:page.marginLeft,paddingRight:page.marginRight}}>
   {mode==='native-rich-text'?renderRichEditor(page,context):<TextSelectionAndCaret scope={owner+':'+page.id} revision={revision} label={page.label} initialText={page.text} contentRevision={page.contentRevision} selection={context.selection} onTextChange={context.onTextChange} onSelectionChange={context.onSelectionChange} onFocus={context.onFocus} onContentSizeChange={context.onMeasuredContent} readOnly={off} showSelectionFields={false} unstyled={unstyled} nativeInputProps={{scrollEnabled:false}} inputStyle={{height:page.height-page.marginTop-page.marginBottom,padding:0}}/>}
  </View>
  {page.oversetCharacters>0?<Text {...{className:unstyled?undefined:'text-text bg-surface-raised'}} style={{position:'absolute',bottom:0,left:0,right:0}}>{page.oversetCharacters} overset characters</Text>:null}
 </View>;})}
 </ScrollView></ScrollView><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
