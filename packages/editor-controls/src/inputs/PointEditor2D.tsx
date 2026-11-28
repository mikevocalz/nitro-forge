import {forgeRadius} from "../radius.ts";
import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {PropertyInspector} from './PropertyInspector.tsx';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {controlIdentity,useScopedControl,type ScopedControlProps} from './useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";
export interface EditorPoint2D {id:string;label:string;x:number;y:number}
export interface PointEditor2DProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 points:readonly EditorPoint2D[];selectedId:string|null;onSelect:(id:string)=>void;
 onCommit:(point:EditorPoint2D,signal?:AbortSignal)=>unknown;renderPreview:(points:readonly EditorPoint2D[])=>ReactNode;unstyled?:boolean;
}
/** Normalized point editor with one active 44pt native grip and equivalent numeric controls. */
export function PointEditor2D({scope='point-editor',revision=0,...props}:PointEditor2DProps){
 const {points,selectedId,onSelect:_select,onCommit:_commit,renderPreview,unstyled=false,disabledReason,style,...rest}=props;
 if(points.length>64||new Set(points.map(p=>p.id)).size!==points.length||points.some(p=>!p.id.trim()||p.id.length>256||!p.label.trim()||p.label.length>1024||![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)))throw new RangeError('Invalid normalized editor points');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,v=useStore(store,s=>s),active=useRef<{point:EditorPoint2D;width:number;height:number}|null>(null);
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),points,selectedId,disabledReason]),v.width,v.height]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined,point=points.find(p=>p.id===selectedId),shown=v.draft??point;
 const cancel=()=>{active.current=null;store.setState({draft:null});};useLayoutEffect(()=>{cancel();},[owner,off]);
 const translated=(x:number,y:number)=>{const a=active.current;return a?{...a.point,x:Math.max(0,Math.min(1,a.point.x+x/a.width)),y:Math.max(0,Math.min(1,a.point.y+y/a.height))}:null;};
 const gesture=usePanGesture({enabled:!off&&!!point&&v.width>44&&v.height>44,runOnJS:true,maxPointers:1,minDistance:2,
 onActivate:()=>{const h=guard.current(),p=h?.points.find(p=>p.id===h.selectedId),s=store.getState();if(p)active.current={point:p,width:s.width-tokens.spacing.fixedTarget,height:s.height-tokens.spacing.fixedTarget};},
 onUpdate:e=>{const p=translated(e.translationX,e.translationY);if(p)store.setState({draft:p});},
 onTouchesDown:e=>{if(e.numberOfTouches>1)cancel();},onDeactivate:e=>{if(e.canceled){cancel();return;}const p=translated(e.translationX,e.translationY);cancel();if(p)void guard.run('point',(h,s)=>h.points.some(q=>q.id===p.id)?h.onCommit(p,s):undefined);},onFinalize:e=>{if(e.canceled)cancel();}});
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]}><Select label="Active point" value={selectedId??''} options={points.map(p=>({value:p.id,label:p.label}))} disabled={off||points.length===0} unstyled={unstyled} onValueChange={id=>{const h=guard.current();if(h?.points.some(p=>p.id===id))h.onSelect(id);}}/>
 <View style={{height:controlTokens.extent.preview,minWidth:tokens.spacing.fixedTarget,overflow:'hidden'}} onLayout={e=>{const {width,height}=e.nativeEvent.layout;if(width!==v.width||height!==v.height)store.setState({width,height});}}><View pointerEvents="none" style={{position:'absolute',left:tokens.spacing.off22,top:tokens.spacing.off22,right:tokens.spacing.off22,bottom:tokens.spacing.off22}}>{renderPreview(points.map(p=>v.draft?.id===p.id?v.draft:p))}</View>
 {shown?<GestureDetector gesture={gesture}><View collapsable={false} accessibilityLabel={'Drag '+shown.label} style={{position:'absolute',left:shown.x*Math.max(0,v.width-44),top:shown.y*Math.max(0,v.height-44),width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,alignItems:'center',justifyContent:'center'}}><View {...{className:unstyled?undefined:'border-2 border-focus bg-surface-raised'}} style={{width:tokens.spacing.off18,height:tokens.spacing.off18,borderRadius:forgeRadius.sm}}/></View></GestureDetector>:null}</View>
 {point?<PropertyInspector scope={scope} revision={revision} label={point.label} disabledReason={off?'Point editing unavailable':undefined} unstyled={unstyled} fields={(['x','y'] as const).map(axis=>({kind:'number',id:axis,label:axis.toUpperCase(),value:point[axis],min:0,max:1,step:.001}))} onCommit={(axis,value)=>guard.run('point',(h,s)=>{const p=h.points.find(p=>p.id===h.selectedId);if(p&&(axis==='x'||axis==='y')&&typeof value==='number'&&value>=0&&value<=1)return h.onCommit({...p,[axis]:value},s);})}/>:null}<ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(){return createStore(()=>({width:0,height:0,draft:null as EditorPoint2D|null}));}
