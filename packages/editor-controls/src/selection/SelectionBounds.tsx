import {useContext,useLayoutEffect,useRef,type ComponentRef,type ReactNode} from 'react';
import {Platform,Text,View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {shellKey} from '@nyc-tron/ui/components/shell/shell-keys';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import type {Rect2D} from '@nyc-tron/ui/components/overlays/popover-position';
import {docPointToScreen,screenPointToDoc,validateViewport,type CanvasViewport,type DocPoint} from '../canvas/canvas-viewport.ts';
import {snapRotation} from '../canvas/transform-origin-model.ts';
import {CanvasGestureRelations} from '@nyc-tron/ui/components/gestures/canvas-gesture-relations';
import {SelectionOutline} from './SelectionOutline.tsx';
import {RESIZE_HANDLES,editSelectionFrame,selectionFrameCorners,selectionHandlePoint,selectionResizeDirection,stepSelectionFrame,validateSelectionFrame,type SelectionEditLimits,type SelectionFrame,type SelectionHandle} from './selection-bounds-model.ts';
export type {SelectionFrame,SelectionHandle} from './selection-bounds-model.ts';
export interface SelectionBoundsProps extends Omit<ViewProps,'children'> {
 scope:string;revision?:string|number;frame:SelectionFrame;viewport:CanvasViewport;
 onPreview?:(frame:SelectionFrame|undefined)=>void;
 onCommit:(frame:SelectionFrame,detail:{handle:SelectionHandle;source:'pointer'|'keyboard'|'accessibility'})=>void;
 limits?:SelectionEditLimits;disabled?:boolean;
 /** Local usable panes from the app's existing layout owner. */
 usableRegions?:readonly Rect2D[];
 renderHandle?:(handle:SelectionHandle,editing:boolean)=>ReactNode;
 className?:string;handleClassName?:string;unstyled?:boolean;
}
type Layout={points:Partial<Record<SelectionHandle,DocPoint>>;compact:boolean;panes:Partial<Record<SelectionHandle,Rect2D|undefined>>;pane:Rect2D|undefined};
type Local={preview:SelectionFrame|undefined;layout:Layout|undefined};
type WindowFrame={x:number;y:number;width:number;height:number};
type Active={boundary:string;handle:SelectionHandle;from:SelectionFrame;value:SelectionFrame;start:DocPoint;last:DocPoint;measured:WindowFrame|null;released:boolean;compact:boolean};
const allHandles=[...RESIZE_HANDLES,'move','rotate'] as const;
const inside=(pane:Rect2D,x:number,y:number)=>x>=pane.x&&y>=pane.y&&x+44<=pane.x+pane.width&&y+44<=pane.y+pane.height;
const equal=(a:SelectionFrame,b:SelectionFrame)=>Object.keys(a).every(key=>a[key as keyof SelectionFrame]===b[key as keyof SelectionFrame]);
const handleLabel=(handle:SelectionHandle)=>handle==='move'?'Move selection':handle==='rotate'?'Rotate selection':'Resize selection '+handle.replaceAll('-',' ');
/** Scope-safe move/resize/rotation handles. Mount under GestureHandlerRootView; the host owns its document. */
export function SelectionBounds({scope,revision=0,frame,viewport,onPreview,onCommit,limits={},disabled=false,usableRegions,renderHandle,className,handleClassName,unstyled=false,style,...rest}:SelectionBoundsProps){
 validateSelectionFrame(frame);validateViewport(viewport);
 if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid selection bounds identity');
 // Validate the edit limits even before the first interaction.
 editSelectionFrame(frame,'bottom-right',{x:0,y:0},{x:0,y:0},limits);
 const regions=usableRegions??[{x:0,y:0,width:viewport.width,height:viewport.height}];
 if(regions.length>256||regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<0||r.height<0))throw new RangeError('Invalid selection usable regions');
 const navigation=useContext(CanvasGestureRelations);
 const off=disabled||navigation.onePointerPan||viewport.width<=0||viewport.height<=0;
 const boundary=JSON.stringify([scope,revision,frame,viewport,limits,off,regions]);
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,state=useStore(store,s=>s),host=useRef<ComponentRef<typeof View>|null>(null),mounted=useRef(false),active=useRef<Active|null>(null);
 const latest=useRef({boundary,off,frame,viewport,limits,regions,onPreview,onCommit});
 useLayoutEffect(()=>{latest.current={boundary,off,frame,viewport,limits,regions,onPreview,onCommit};});
 const current=()=>mounted.current&&!off&&latest.current.boundary===boundary?latest.current:null;
 const cancel=()=>{const before=active.current;active.current=null;store.setState({preview:undefined,layout:undefined});const p=current();if(before&&p&&before.boundary===p.boundary)p.onPreview?.(undefined);};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current=null;};},[]);
 useLayoutEffect(()=>{active.current=null;store.setState({preview:undefined,layout:undefined});},[boundary]);
 const shown=state.preview??frame,screenCorners=selectionFrameCorners(shown).map(([x,y])=>docPointToScreen(viewport,{x,y}));
 if(screenCorners.some(p=>![p.x,p.y].every(Number.isFinite)))throw new RangeError('Selection cannot be projected into this viewport');
 const pointOf=(handle:SelectionHandle)=>docPointToScreen(viewport,selectionHandlePoint(shown,handle,52/viewport.zoom));
 const pane=regions.filter(r=>r.width>=44&&r.height>=44).reduce<Rect2D|undefined>((best,r)=>!best||r.width*r.height>best.width*best.height?r:best,undefined);
 const panes:Layout['panes']={},points:Layout['points']={};for(const handle of allHandles){const p=pointOf(handle);points[handle]=p;panes[handle]=regions.find(r=>inside(r,p.x-22,p.y-22));}
 const desired:Layout={points,compact:Math.min(frame.width,frame.height)*viewport.zoom<132||allHandles.some(h=>!panes[h]),panes,pane};
 const layout=state.layout??desired;
 const finish=(gesture:Active)=>{const p=current();if(!p||active.current!==gesture||!gesture.measured||!gesture.released)return;active.current=null;store.setState({preview:undefined,layout:undefined});if(!equal(gesture.from,gesture.value))p.onCommit(gesture.value,{handle:gesture.handle,source:'pointer'});else p.onPreview?.(undefined);};
 const update=(gesture:Active)=>{const p=current(),at=gesture.measured;if(!p||active.current!==gesture||gesture.boundary!==p.boundary||!at)return;
  const toDoc=(point:DocPoint)=>screenPointToDoc(p.viewport,{x:(point.x-at.x)*p.viewport.width/at.width,y:(point.y-at.y)*p.viewport.height/at.height});
  const from=toDoc(gesture.start),to=toDoc(gesture.last);
  gesture.value=gesture.compact&&gesture.handle==='rotate'?{...gesture.from,rotation:snapRotation(gesture.from.rotation+(gesture.last.x-gesture.start.x)/4,p.limits.snapAngle)}:editSelectionFrame(gesture.from,gesture.handle,from,to,p.limits);
  store.setState({preview:gesture.value});p.onPreview?.(gesture.value);finish(gesture);
 };
 const begin=(handle:SelectionHandle,point:DocPoint)=>{const p=current();if(!p)return;cancel();const gesture:Active={boundary:p.boundary,handle,from:p.frame,value:p.frame,start:point,last:point,measured:null,released:false,compact:layout.compact};active.current=gesture;store.setState({layout});host.current?.measureInWindow((x,y,width,height)=>{if(!current()||active.current!==gesture||![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)return;gesture.measured={x,y,width,height};const localPoint={x:(point.x-x)*p.viewport.width/width,y:(point.y-y)*p.viewport.height/height};if(!p.regions.some(r=>localPoint.x>=r.x&&localPoint.y>=r.y&&localPoint.x<=r.x+r.width&&localPoint.y<=r.y+r.height)){cancel();return;}update(gesture);});};
 const move=(handle:SelectionHandle,point:DocPoint)=>{const gesture=active.current;if(!current()||gesture?.handle!==handle||gesture.released)return;gesture.last=point;update(gesture);};
 const release=(handle:SelectionHandle,point:DocPoint)=>{const gesture=active.current;if(!current()||gesture?.handle!==handle||gesture.released)return;gesture.last=point;gesture.released=true;update(gesture);};
 const step=(handle:SelectionHandle,dx:number,dy:number,source:'keyboard'|'accessibility')=>{if(!current())return;cancel();const p=current();if(!p)return;const next=stepSelectionFrame(p.frame,handle,dx,dy,p.limits);if(!equal(p.frame,next))p.onCommit(next,{handle,source});};
 const adjust=(handle:SelectionHandle,by:number)=>{const p=current();if(!p)return;const delta=handle==='move'||handle==='rotate'?{x:1,y:0}:selectionResizeDirection(p.frame,handle);step(handle,delta.x*by,delta.y*by,'accessibility');};
 const control=(handle:SelectionHandle,left:number,top:number,offset:DocPoint={x:0,y:0})=>{const editing=active.current?.handle===handle,label=handleLabel(handle);return <SelectionGestureArea key={handle} disabled={off} onBegin={point=>begin(handle,point)} onMove={point=>move(handle,point)} onRelease={point=>release(handle,point)} onCancel={()=>{if(current()&&active.current?.handle===handle)cancel();}}>
  <View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{disabled:off}} aria-disabled={off} accessibilityValue={{min:handle==='rotate'?-180:handle==='move'?-1e12:0,max:handle==='rotate'?180:1e12,now:handle==='rotate'?snapRotation(shown.rotation):handle==='move'?shown.centerX:handle==='top'||handle==='bottom'?shown.height:shown.width,text:handle==='move'?`Position ${shown.centerX}, ${shown.centerY}`:handle==='rotate'?`${shown.rotation} degrees`:`${shown.width} by ${shown.height}`}} accessibilityHint={layout.compact&&handle==='rotate'?'Drag horizontally to rotate. Arrow keys step the angle.':'Drag to adjust. Arrow keys step in document coordinates; Shift uses ten units.'}
   accessibilityActions={off?[]:[{name:'increment',label:'Increase'},{name:'decrement',label:'Decrease'},...(handle==='move'?[{name:'up',label:'Move up'},{name:'down',label:'Move down'}]:[])]} onAccessibilityAction={event=>{const action=event.nativeEvent.actionName;if(action==='increment')adjust(handle,1);else if(action==='decrement')adjust(handle,-1);else if(handle==='move'&&action==='up')step(handle,0,-1,'accessibility');else if(handle==='move'&&action==='down')step(handle,0,1,'accessibility');}}
   {...(Platform.OS==='web'?{tabIndex:off?-1 as const:0 as const,onKeyDown:(event:unknown)=>{const key=shellKey(event);if(key.key==='Escape'){key.preventDefault();if(current())cancel();return;}if(key.ctrlKey||key.metaKey||key.altKey)return;const amount=key.shiftKey?10:1,axes:Record<string,readonly[number,number]>={ArrowLeft:[-amount,0],ArrowRight:[amount,0],ArrowUp:[0,-amount],ArrowDown:[0,amount]};const delta=axes[key.key??''];if(delta){key.preventDefault();step(handle,delta[0],delta[1],'keyboard');}}}:{})}
   {...{className:joinClasses(!unstyled&&'focus-visible:ring-2 focus-visible:ring-focus',!unstyled&&layout.compact&&'border border-primary bg-surface-raised rounded-control',handleClassName)}} style={{position:'absolute',left,top,width:44,height:44,alignItems:'center',justifyContent:'center',opacity:off?.5:1}}>
   <View pointerEvents="none" style={{transform:[{translateX:offset.x},{translateY:offset.y}]}}>{renderHandle?.(handle,editing)??(layout.compact?<Text pointerEvents="none" {...{className:joinClasses(!unstyled&&'text-text')}} style={{fontSize:10}}>{handle==='move'?'Move':handle==='rotate'?'Turn':'Size'}</Text>:<View pointerEvents="none" {...{className:joinClasses(!unstyled&&'border border-primary bg-surface-raised rounded-control')}} style={{width:handle==='move'||handle==='rotate'?30:10,height:handle==='move'||handle==='rotate'?24:10,alignItems:'center',justifyContent:'center'}}>{handle==='move'||handle==='rotate'?<Text {...{className:joinClasses(!unstyled&&'text-text')}} style={{fontSize:10}}>{handle==='move'?'Move':'Turn'}</Text>:null}</View>)}</View>
  </View></SelectionGestureArea>;};
 const compactHandles=['move','bottom-right','rotate'] as const,vertical=!!layout.pane&&layout.pane.width<148&&layout.pane.height>=148,fit=!!layout.pane&&(layout.pane.width>=148||vertical);
 return <View {...rest} {...{className:joinClasses(className)}} ref={host} collapsable={false} pointerEvents="box-none" style={[{position:'absolute',left:0,top:0,width:viewport.width,height:viewport.height,overflow:'hidden',direction:'ltr'},style]}>
  {regions.map((r,index)=><View key={index} pointerEvents="none" style={{position:'absolute',left:r.x,top:r.y,width:r.width,height:r.height,overflow:'hidden'}}><SelectionOutline points={screenCorners.map(p=>({x:p.x-r.x,y:p.y-r.y}))} width={r.width} height={r.height} unstyled={unstyled}/></View>)}
  {layout.compact?(fit?compactHandles.map((handle,index)=>control(handle,layout.pane!.x+(vertical?0:index*52),layout.pane!.y+(vertical?index*52:0))):<Text accessibilityRole="alert" {...{className:joinClasses(!unstyled&&'text-text')}} style={{position:'absolute',left:layout.pane?.x??0,top:layout.pane?.y??0,width:layout.pane?.width??viewport.width}}>More space is needed for selection controls</Text>):allHandles.map(handle=>{const p=pointOf(handle),hit=layout.points[handle]??p,r=layout.panes[handle]!;return <View key={handle} pointerEvents="box-none" style={{position:'absolute',left:r.x,top:r.y,width:r.width,height:r.height,overflow:'hidden'}}>{control(handle,hit.x-r.x-22,hit.y-r.y-22,{x:p.x-hit.x,y:p.y-hit.y})}</View>;})}
 </View>;
}
function makeStore(){return createStore<Local>(()=>({preview:undefined,layout:undefined}));}
function SelectionGestureArea({children,disabled,onBegin,onMove,onRelease,onCancel}:{children:ReactNode;disabled:boolean;onBegin:(point:DocPoint)=>void;onMove:(point:DocPoint)=>void;onRelease:(point:DocPoint)=>void;onCancel:()=>void}){
 const relations=useContext(CanvasGestureRelations);
 const seed=useRef<DocPoint|null>(null),began=useRef(false),rejected=useRef(false),latest=useRef({onBegin,onMove,onRelease,onCancel});useLayoutEffect(()=>{latest.current={onBegin,onMove,onRelease,onCancel};});
 const gesture=usePanGesture({enabled:!disabled,runOnJS:true,simultaneousWith:relations.gestures,minDistance:0,maxPointers:1,onBegin:event=>{seed.current={x:event.absoluteX,y:event.absoluteY};began.current=false;rejected.current=event.numberOfPointers>1;},onTouchesDown:event=>{if(event.numberOfTouches!==1){rejected.current=true;seed.current=null;began.current=false;latest.current.onCancel();return;}const touch=event.changedTouches[0];if(touch&&!seed.current)seed.current={x:touch.absoluteX,y:touch.absoluteY};},onActivate:event=>{if(rejected.current)return;began.current=true;latest.current.onBegin(seed.current??{x:event.absoluteX,y:event.absoluteY});},onUpdate:event=>{if(began.current)latest.current.onMove({x:event.absoluteX,y:event.absoluteY});},onTouchesUp:event=>{if(!began.current)return;const touch=event.changedTouches[0];if(touch){began.current=false;latest.current.onRelease({x:touch.absoluteX,y:touch.absoluteY});}},onTouchesCancel:()=>{if(began.current)latest.current.onCancel();began.current=false;seed.current=null;rejected.current=true;},onDeactivate:event=>{if(!began.current)return;began.current=false;if(event.canceled)latest.current.onCancel();else latest.current.onRelease({x:event.absoluteX,y:event.absoluteY});},onFinalize:event=>{if(event.canceled&&began.current){began.current=false;latest.current.onCancel();}}});
 return <GestureDetector gesture={gesture} touchAction="none" userSelect="none">{children}</GestureDetector>;
}
