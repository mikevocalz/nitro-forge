import {useMemo,useRef,useLayoutEffect} from 'react';
import type {ReactNode} from 'react';
import {FlatList,ScrollView,Text,View,useWindowDimensions,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {validatePDFPages,type PDFPageDescriptor,type PDFPageLayout} from './pdf-page-model.ts';
export interface PDFPageSurfaceContext {width:number;height:number;scale:number;rotation:0|90|180|270;active:boolean;scope:string}
export interface VirtualPDFPageViewerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 pages:readonly PDFPageDescriptor[];currentPageId:string|null;layout:PDFPageLayout;zoom:number;viewportHeight?:number;readingDirection?:'ltr'|'rtl';
 /** Actual native PDF text/vector surface. The PDF document and renderer resources remain host owned. */
 renderPage:(page:PDFPageDescriptor,context:PDFPageSurfaceContext)=>ReactNode;
 onVisiblePagesChange:(pageIds:readonly string[])=>void;onCurrentPageChange:(id:string)=>void;
 revealRequest?:{pageId:string;token:string|number};
 status:'loading'|'ready'|'password-required'|'error';error?:string;onRequestUnlock?:()=>void;unstyled?:boolean;
}
export function VirtualPDFPageViewer({scope='pdf-pages',revision=0,...props}:VirtualPDFPageViewerProps){
 const {pages,currentPageId,layout,zoom,viewportHeight=720,readingDirection='ltr',renderPage,onVisiblePagesChange:_visible,onCurrentPageChange:_current,revealRequest,status,error,onRequestUnlock,unstyled=false,disabledReason,style,...rest}=props;
 useMemo(()=>validatePDFPages(pages),[pages]);if(!Number.isFinite(zoom)||zoom<.1||zoom>4||!Number.isFinite(viewportHeight)||viewportHeight<88||viewportHeight>8192||!['single','continuous','two-up','facing'].includes(layout)||!['loading','ready','password-required','error'].includes(status))throw new RangeError('Invalid PDF viewport');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,width=useStore(store,s=>s.width),currentIndex=Math.max(0,pages.findIndex(p=>p.id===currentPageId)),paired=layout==='two-up'||layout==='facing',contentWidth=width*zoom,pageWidth=Math.max(0,(contentWidth-(paired?12:0))/(paired?2:1));
 const rows=useMemo(()=>{const out:PDFPageDescriptor[][]=[];if(layout==='single')return pages[currentIndex]?[[pages[currentIndex]!]]:[];for(let i=0;i<pages.length;){const count=!paired||layout==='facing'&&i===0?1:2;out.push(pages.slice(i,i+count));i+=count;}return out;},[pages,layout,currentIndex]);
 const {fontScale}=useWindowDimensions(),headerHeight=Math.max(56,Math.ceil(44*fontScale)+12);
 const heights=rows.map(row=>Math.max(...row.map(p=>pageWidth*((p.rotation===90||p.rotation===270)?p.width/p.height:p.height/p.width)))+headerHeight),offsets:number[]=[];let total=0;for(const height of heights){offsets.push(total);total+=height;}if(!Number.isFinite(total)||total>2147483647)throw new RangeError('PDF layout exceeds native scroll-coordinate bounds');
 const list=useRef<FlatList<PDFPageDescriptor[]>|null>(null);useLayoutEffect(()=>{if(!revealRequest||width<=0)return;const index=rows.findIndex(row=>row.some(page=>page.id===revealRequest.pageId));if(index>=0)list.current?.scrollToOffset({offset:offsets[index]??0,animated:false});},[revealRequest?.token,revealRequest?.pageId,owner,width,layout,pages]);
 const view=useRef({owner,guard,rows});view.current={owner,guard,rows};const onVisible=useRef(({viewableItems}:{viewableItems:readonly {item:PDFPageDescriptor[]}[]})=>{const v=view.current,h=v.guard.current();if(h)h.onVisiblePagesChange(viewableItems.flatMap(row=>row.item.map(p=>p.id)));}).current;
 return <View {...rest} onLayout={e=>{const w=e.nativeEvent.layout.width;if(Number.isFinite(w)&&w>=0)store.setState({width:w});rest.onLayout?.(e);}} style={[{minWidth:0,minHeight:0,gap:8},style]} accessibilityLabel="PDF page viewer">
 {status==='ready'&&width>0?<ScrollView horizontal nestedScrollEnabled style={{height:viewportHeight}}><FlatList ref={list} data={rows} keyExtractor={row=>row.map(p=>p.id).join(':')} initialNumToRender={3} windowSize={5} style={{width:contentWidth,height:viewportHeight}} getItemLayout={(_data,index)=>({index,length:heights[index]??0,offset:offsets[index]??0})} onViewableItemsChanged={onVisible} viewabilityConfig={{itemVisiblePercentThreshold:1}} extraData={[currentPageId,zoom,readingDirection]} renderItem={({item,index})=><View style={{height:heights[index],gap:12,flexDirection:readingDirection==='rtl'?'row-reverse':'row',justifyContent:layout==='facing'&&index===0?(readingDirection==='ltr'?'flex-end':'flex-start'):'flex-start',direction:'ltr'}}>{item.map(page=>{const rotated=page.rotation===90||page.rotation===270,height=pageWidth*(rotated?page.width/page.height:page.height/page.width),scale=pageWidth/(rotated?page.height:page.width);return <View key={page.id} style={{width:pageWidth,gap:4}}><Button numberOfLines={1} title={page.label} variant="ghost" accessibilityState={{selected:page.id===currentPageId}} disabled={disabledReason!==undefined} unstyled={unstyled} onPress={()=>guard.current()?.onCurrentPageChange(page.id)}/><View style={{width:pageWidth,height,overflow:'hidden'}}>{renderPage(page,{width:pageWidth,height,scale,rotation:page.rotation,active:page.id===currentPageId,scope:owner})}</View></View>;})}</View>}/></ScrollView>:<Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{status==='password-required'?'PDF needs a password':status==='loading'?'Loading PDF pages':status==='error'?'PDF could not be opened':pages.length===0?'PDF has no pages':'Measuring PDF pane'}</Text>}
 {status==='password-required'&&onRequestUnlock?<Button title="Unlock PDF" unstyled={unstyled} onPress={()=>guard.current()?.onRequestUnlock?.()}/>:null}<ErrorMessage message={error??disabledReason} unstyled={unstyled}/></View>;
}
function makeStore(){return createStore(()=>({width:0}));}

export type {PDFPageDescriptor,PDFPageLayout} from './pdf-page-model.ts';
