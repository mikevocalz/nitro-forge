import {useLayoutEffect,useRef} from 'react';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import type {ReactNode} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {PointEditor2D,type EditorPoint2D} from '../inputs/PointEditor2D.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface PDFScanPage {id:string;label:string;corners:readonly EditorPoint2D[];rotation:0|90|180|270;correctionStatus:'original'|'processing'|'corrected'|'error';error?:string}
export interface PDFScanSessionProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 permission:'unknown'|'granted'|'denied';cameraSurface:ReactNode;pages:readonly PDFScanPage[];selectedId:string|null;selectedCornerId:string|null;
 status:'idle'|'capturing'|'building'|'complete'|'error';outputDocumentId?:string;canAppend:boolean;canReplace:boolean;
 onPermission:(signal?:AbortSignal)=>unknown;onCapture:(signal?:AbortSignal)=>unknown;onSelect:(id:string)=>void;onSelectCorner:(id:string)=>void;
 onCorrect:(id:string,corners:readonly EditorPoint2D[],rotation:number,signal?:AbortSignal)=>unknown;
 onMove:(id:string,index:number,signal?:AbortSignal)=>unknown;onRemove:(id:string,signal?:AbortSignal)=>unknown;
 onBuild:(mode:'append'|'replace',pageIds:readonly string[],signal?:AbortSignal)=>unknown;
 renderPage:(page:PDFScanPage,corners:readonly EditorPoint2D[])=>ReactNode;unstyled?:boolean;
}
/** Actual native camera surfaces and scan artifacts are supplied by the host; correction never substitutes a CSS transform for a processed image. */
export function PDFScanSession({scope='pdf-scan',revision=0,...props}:PDFScanSessionProps){
 const {permission,cameraSurface,pages,selectedId,selectedCornerId,status,outputDocumentId,canAppend,canReplace,onPermission:_permission,onCapture:_capture,onSelect:_select,onSelectCorner:_corner,onCorrect:_correct,onMove:_move,onRemove:_remove,onBuild:_build,renderPage,unstyled=false,disabledReason,style,...rest}=props;
 if(pages.length>4096||new Set(pages.map(p=>p.id)).size!==pages.length||pages.some(p=>!p.id.trim()||p.corners.length!==4||new Set(p.corners.map(c=>c.id)).size!==4||p.corners.some(c=>![c.x,c.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))||![0,90,180,270].includes(p.rotation))||!['unknown','granted','denied'].includes(permission)||!['idle','capturing','building','complete','error'].includes(status))throw new RangeError('Invalid scan session');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,confirmed=useStore(store,s=>s.replace),correctionScope=useEditorBoundary([scope,revision,selectedId]);useLayoutEffect(()=>{store.setState({replace:false});},[owner,JSON.stringify(pages.map(p=>[p.id,p.corners,p.rotation]))]);
 const guard=useScopedControl(owner,props,disabledReason!==undefined||status==='capturing'||status==='building'),off=guard.pending||disabledReason!==undefined||status==='capturing'||status==='building',page=pages.find(p=>p.id===selectedId);
 const build=(mode:'append'|'replace')=>guard.run(mode,(h,s)=>{if(!h.pages.length||h.pages.some(p=>p.correctionStatus==='processing'||p.correctionStatus==='error')||mode==='append'&&!h.canAppend||mode==='replace'&&!h.canReplace)throw new Error('Scan pages are not ready');return h.onBuild(mode,h.pages.map(p=>p.id),s);});
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="PDF scan session">{permission==='granted'?<View style={{height:220}}>{cameraSurface}</View>:<Button title={permission==='denied'?'Review camera permission':'Allow camera access'} unstyled={unstyled} disabled={off} onPress={()=>guard.run('permission',(h,s)=>h.onPermission(s))}/>}
 <Button title="Capture scan page" disabled={off||permission!=='granted'} unstyled={unstyled} onPress={()=>guard.run('capture',(h,s)=>h.permission==='granted'?h.onCapture(s):undefined)}/>
 <FlatList style={{height:180}} data={pages} keyExtractor={p=>p.id} renderItem={({item,index})=><View style={{gap:4}}><Button title={item.label} disabled={off} accessibilityState={{selected:item.id===selectedId}} variant="secondary" unstyled={unstyled} onPress={()=>{const h=guard.current();if(h?.pages.some(p=>p.id===item.id))h.onSelect(item.id);}}/><View style={{flexDirection:'row',gap:4,flexWrap:'wrap'}}>{[-1,1].map(delta=><Button key={delta} title={delta<0?'Earlier':'Later'} disabled={off||index+delta<0||index+delta>=pages.length} unstyled={unstyled} onPress={()=>guard.run('move',(h,s)=>{const i=h.pages.findIndex(p=>p.id===item.id);if(i>=0&&i+delta>=0&&i+delta<h.pages.length)return h.onMove(item.id,i+delta,s);})}/>)}<Button title="Remove scan page" disabled={off} unstyled={unstyled} onPress={()=>guard.run('remove',(h,s)=>h.pages.some(p=>p.id===item.id)?h.onRemove(item.id,s):undefined)}/></View></View>}/>
 {page?<><PointEditor2D scope={correctionScope} revision={revision} points={page.corners} selectedId={selectedCornerId} onSelect={id=>guard.current()?.onSelectCorner(id)} disabledReason={off||page.correctionStatus==='processing'?'Scan correction unavailable':undefined} unstyled={unstyled} renderPreview={corners=>renderPage(page,corners)} onCommit={point=>guard.run('correct',(h,s)=>{const p=h.pages.find(p=>p.id===page.id);if(p&&p.correctionStatus!=='processing')return h.onCorrect(p.id,p.corners.map(c=>c.id===point.id?point:c),p.rotation,s);})}/><Button title="Rotate scan page clockwise" disabled={off||page.correctionStatus==='processing'} unstyled={unstyled} onPress={()=>guard.run('rotate',(h,s)=>{const p=h.pages.find(p=>p.id===page.id);if(p&&p.correctionStatus!=='processing')return h.onCorrect(p.id,p.corners,(p.rotation+90)%360,s);})}/><ErrorMessage {...exact({message:page.error,unstyled:unstyled})}/></>:null}
 <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}><Button title="Append scans to PDF" disabled={off||!canAppend||!pages.length} unstyled={unstyled} onPress={()=>build('append')}/><Button title={confirmed?"Confirm replace PDF with scans":"Replace PDF with scans"} disabled={off||!canReplace||!pages.length} unstyled={unstyled} onPress={()=>{if(store.getState().replace){store.setState({replace:false});return build('replace');}store.setState({replace:true});}}/></View>{confirmed?<Button title="Cancel PDF replacement" variant="secondary" unstyled={unstyled} onPress={()=>store.setState({replace:false})}/>:null}<Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{status==='complete'&&outputDocumentId?'Host scan output: '+outputDocumentId:status==='building'?'Building PDF from scan artifacts':pages.length+' captured pages'}</Text><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}

function makeStore(){return createStore(()=>({replace:false}));}
