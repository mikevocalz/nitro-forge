import {createCoordinateAdmission,createCoordinatePreviewOwner,finishCoordinateEdit} from '@nyc-tron/ui/components/gestures/coordinate-admission';
import {useLayoutEffect,useRef} from 'react';
import {View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import type {SheetRange} from '../sheet-window.ts';
import {fillTarget,type FillPlan} from './fill-handle.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface SelectionPane {id:string;x:number;y:number;width:number;height:number;startRow:number;endRow:number;startColumn:number;endColumn:number;scrollX:number;scrollY:number}
export interface CellSelectionOverlayProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 range:SheetRange;rowCount:number;columnCount:number;rowHeight:number;columnWidth:number;
 /** Separate nonoccluded grid/frozen-pane rectangles supplied by the layout owner. */
 panes:readonly SelectionPane[];interaction?:'resize'|'fill';onPreview?:(range:SheetRange|null)=>void;
 onRangeCommit?:(range:SheetRange,signal?:AbortSignal)=>unknown;onFillCommit?:(plan:FillPlan,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
function validRange(r:SheetRange,rows:number,cols:number){return [r.startRow,r.endRow,r.startColumn,r.endColumn].every(Number.isSafeInteger)&&r.startRow>=0&&r.startColumn>=0&&r.endRow>=r.startRow&&r.endColumn>=r.startColumn&&r.endRow<rows&&r.endColumn<cols;}
export function CellSelectionOverlay({scope='cell-selection',revision=0,...props}:CellSelectionOverlayProps){
 const {range,rowCount,columnCount,rowHeight,columnWidth,panes,interaction='resize',onPreview:_preview,onRangeCommit:_commit,onFillCommit:_fill,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(rowCount)||!Number.isSafeInteger(columnCount)||!validRange(range,rowCount,columnCount)||![rowHeight,columnWidth].every(n=>Number.isFinite(n)&&n>0)||panes.length>16||new Set(panes.map(p=>p.id)).size!==panes.length||panes.some(p=>!p.id.trim()||p.id.length>256||![p.x,p.y,p.width,p.height,p.scrollX,p.scrollY].every(Number.isFinite)||p.width<0||p.height<0||p.scrollX<0||p.scrollY<0||!validRange(p,rowCount,columnCount)))throw new RangeError('Invalid cell selection geometry');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),range,rowCount,columnCount,rowHeight,columnWidth,panes,interaction,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined||!(interaction==='fill'?props.onFillCommit:props.onRangeCommit);
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,preview=useStore(store,s=>s.preview),shown=preview??range;
 const previews=useRef<ReturnType<typeof createCoordinatePreviewOwner<SheetRange>>|null>(null);previews.current??=createCoordinatePreviewOwner();
 useLayoutEffect(()=>{store.setState({preview:null});return()=>{previews.current!.clear(owner);};},[owner,off]);
 const update=(rows:number,columns:number)=>{const plan=interaction==='fill'?fillTarget(range,{rows,columns},{rowCount,columnCount}):undefined,next=interaction==='fill'?(plan?.target??range):{...range,endRow:Math.max(range.startRow,Math.min(rowCount-1,range.endRow+rows)),endColumn:Math.max(range.startColumn,Math.min(columnCount-1,range.endColumn+columns))};if(!guard.current())return;store.setState({preview:next});const host=guard.current();if(host?.onPreview)previews.current!.publish(owner,host.onPreview,next);return {next,plan};};
 const finish=(rows:number,columns:number)=>finishCoordinateEdit(()=>!!guard.current(),()=>update(rows,columns),()=>{store.setState({preview:null});previews.current!.clear(owner);},result=>guard.run('selection',(h,s)=>interaction==='fill'?(result.plan?h.onFillCommit?.(result.plan,s):undefined):h.onRangeCommit?.(result.next,s)));
 const cancel=()=>{if(!guard.current())return;store.setState({preview:null});previews.current!.clear(owner);};
 return <View {...rest} pointerEvents="box-none" style={[{position:'absolute',left:0,top:0,right:0,bottom:0},style]} accessibilityLabel="Cell range overlay">
 {panes.map(p=>{const sr=Math.max(p.startRow,shown.startRow),er=Math.min(p.endRow,shown.endRow),sc=Math.max(p.startColumn,shown.startColumn),ec=Math.min(p.endColumn,shown.endColumn);if(sr>er||sc>ec)return null;const x=(sc-p.startColumn)*columnWidth-p.scrollX,y=(sr-p.startRow)*rowHeight-p.scrollY,w=(ec-sc+1)*columnWidth,h=(er-sr+1)*rowHeight;
 const cornerX=(range.endColumn-p.startColumn+1)*columnWidth-p.scrollX,cornerY=(range.endRow-p.startRow+1)*rowHeight-p.scrollY,hasCorner=range.endRow>=p.startRow&&range.endRow<=p.endRow&&range.endColumn>=p.startColumn&&range.endColumn<=p.endColumn&&cornerX>=0&&cornerY>=0&&cornerX<=p.width&&cornerY<=p.height&&p.width>=44&&p.height>=44;
 return <View key={p.id} pointerEvents="box-none" style={{position:'absolute',left:p.x,top:p.y,width:p.width,height:p.height,overflow:'hidden'}}>
  <View pointerEvents="none" {...{className:unstyled?undefined:'border-primary bg-primary/10'}} style={{position:'absolute',left:x,top:y,width:w,height:h,borderTopWidth:sr===shown.startRow?tokens.borderWidth.strong:0,borderBottomWidth:er===shown.endRow?tokens.borderWidth.strong:0,borderLeftWidth:sc===shown.startColumn?tokens.borderWidth.strong:0,borderRightWidth:ec===shown.endColumn?tokens.borderWidth.strong:0}}/>
  {hasCorner?<RangeHandle key={p.id} boundary={owner} label={interaction==='fill'?'Fill selected cells':'Resize cell selection'} x={Math.min(p.width-44,Math.max(0,cornerX-22))} y={Math.min(p.height-44,Math.max(0,cornerY-22))} rowHeight={rowHeight} columnWidth={columnWidth} disabled={off} unstyled={unstyled} onPreview={update} onCommit={finish} onCancel={cancel}/>:null}
 </View>;})}{panes[0]?<View pointerEvents="none" style={{position:'absolute',left:panes[0].x,top:panes[0].y,maxWidth:panes[0].width,maxHeight:panes[0].height,overflow:'hidden'}}><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>:null}</View>;
}
function RangeHandle({boundary,label,x,y,rowHeight,columnWidth,disabled,unstyled,onPreview,onCommit,onCancel}:{boundary:string;label:string;x:number;y:number;rowHeight:number;columnWidth:number;disabled:boolean;unstyled:boolean;onPreview:(r:number,c:number)=>unknown;onCommit:(r:number,c:number)=>unknown;onCancel:()=>void}){
 const admission=useRef<ReturnType<typeof createCoordinateAdmission>|null>(null);admission.current??=createCoordinateAdmission();const gate=admission.current;
 const coordinates=useEditorBoundary([boundary,disabled]);
 useLayoutEffect(()=>{gate.admit(coordinates);return()=>gate.invalidate(coordinates);},[coordinates,gate]);
 const ready=()=>!disabled&&gate.ready(coordinates);
 const gesture=usePanGesture({enabled:!disabled,runOnJS:true,minDistance:4,maxPointers:1,
  onActivate:()=>{if(ready())gate.begin(coordinates);},
  onUpdate:e=>{if(ready()&&gate.current(coordinates))onPreview(Math.round(e.translationY/rowHeight),Math.round(e.translationX/columnWidth));},
  onDeactivate:e=>{if(!ready()||!gate.finish(coordinates))return;if(e.canceled){onCancel();return;}void onCommit(Math.round(e.translationY/rowHeight),Math.round(e.translationX/columnWidth));},
  onFinalize:e=>{if(!gate.ready(coordinates))return;const active=gate.current(coordinates);gate.cancel();if(active&&e.canceled)onCancel();},
 });
 return <GestureDetector gesture={gesture} touchAction="none"><View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{disabled}} accessibilityActions={[{name:'increment',label:'Extend one row'},{name:'decrement',label:'Reduce one row'}]} onAccessibilityAction={e=>{if(!ready())return;const d=e.nativeEvent.actionName==='increment'?1:e.nativeEvent.actionName==='decrement'?-1:0;if(d)void onCommit(d,0);}} style={{position:'absolute',left:x,top:y,width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,alignItems:'center',justifyContent:'center'}}><View pointerEvents="none" {...{className:unstyled?undefined:'bg-primary border-2 border-surface-raised'}} style={{width:tokens.spacing.off14,height:tokens.spacing.off14}}/></View></GestureDetector>;
}
function makeStore(){return createStore(()=>({preview:null as SheetRange|null}));}
