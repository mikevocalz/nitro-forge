import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {GestureDetector,PointerType,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {webKey} from '@nyc-tron/ui/components/forms/choice-keys';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import type {InkSize} from '../ink/ink-model.ts';
import {INK_SIZES} from '../ink/ink-model.ts';
import {appendPoint,createStrokeIdFactory,normalizePoint,resolvePresenterInkKey,strokeSegments,strokesUnderEraser,validatePresenterStrokes,presenterModeStatus,HIGHLIGHTER_OPACITY,LASER_TRAIL_MS,type PresenterInkMode,type PresenterInkPoint,type PresenterInkStroke} from './presenter-ink-model.ts';
import {exact} from '../exact-optional.ts';
export interface PresenterInkFrame {strokes:readonly PresenterInkStroke[];laser:PresenterInkPoint|undefined;width:number;height:number;frame:number}
export interface PresenterInkOverlayProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 mode:PresenterInkMode;color:string;size:InkSize;strokes:readonly PresenterInkStroke[];
 onStrokeCommit:(stroke:PresenterInkStroke,signal?:AbortSignal)=>void|Promise<unknown>;onRemoveStrokes:(ids:readonly string[],signal?:AbortSignal)=>void|Promise<unknown>;
 onModeChange:(mode:PresenterInkMode)=>void;onLaserPoint?:(point:PresenterInkPoint|null)=>void;disabled?:boolean;reducedMotion?:boolean;
 /** Optional renderer adapter; default portable Views are limited to 4096 points. */
 renderInk?:(frame:PresenterInkFrame)=>ReactNode;unstyled?:boolean;
}
type Sample={x:number;y:number;pointerType:PointerType;stylusData?:{pressure:number}};
/** Shared native recognizer/ink state owner. Renderer adapters never own strokes or capture sessions. */
export function PresenterInkOverlay({scope='presenter-ink',revision=0,...props}:PresenterInkOverlayProps){
 const {mode,color,size,strokes,onStrokeCommit:_stroke,onRemoveStrokes:_remove,onModeChange:_mode,onLaserPoint:_laser,disabled=false,reducedMotion=false,renderInk,unstyled=false,disabledReason,style,...rest}=props;
 validatePresenterStrokes(strokes);const pointCount=strokes.reduce((sum,s)=>sum+s.points.length,0);
 if(strokes.length>4096||pointCount>(renderInk?131072:4096)||!color.trim()||color.length>256||!INK_SIZES.includes(size)||!['off','laser','pen','highlighter','eraser'].includes(mode))throw new RangeError('Presenter ink exceeds the renderer budget or has invalid settings');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),mode,color,size,disabled,disabledReason])]),guard=useScopedControl(owner,props,disabled||disabledReason!==undefined),observe=useScopedControl(owner,props,disabled||disabledReason!==undefined),off=disabled||guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),active=useRef(false),erased=useRef(new Set<string>()),makeId=useRef(createStrokeIdFactory());
 const cancel=()=>{active.current=false;erased.current.clear();store.setState(v=>({draft:undefined,laser:undefined,frame:v.frame+1}));observe.current()?.onLaserPoint?.(null);};
 useLayoutEffect(()=>{cancel();},[owner,off,s.width,s.height]);
 useEffect(()=>{if(!s.laser)return;const timer=setTimeout(()=>{store.setState(v=>({laser:undefined,frame:v.frame+1}));observe.current()?.onLaserPoint?.(null);},reducedMotion?150:LASER_TRAIL_MS);return()=>clearTimeout(timer);},[s.laser,reducedMotion,owner]);
 const point=(e:Sample)=>normalizePoint(e.x,e.y,store.getState(),e.pointerType===PointerType.STYLUS?e.stylusData?.pressure:undefined);
 const move=(e:Sample)=>{const h=guard.current(),v=store.getState();if(!active.current||!h)return;const p=point(e);if(h.mode==='laser'){store.setState(s=>({laser:p,frame:s.frame+1}));h.onLaserPoint?.(p);}else if(h.mode==='eraser'){for(const id of strokesUnderEraser(h.strokes,p,v))erased.current.add(id);}else if(v.draft){if(v.draft.points.length>=(renderInk?8192:Math.max(1,4096-pointCount))){cancel();store.setState({notice:'Stroke limit reached; draw a shorter stroke'});return;}store.setState(s=>({draft:{...v.draft!,points:appendPoint(v.draft!.points,p,v)},frame:s.frame+1}));}};
 const gesture=usePanGesture({enabled:!off&&mode!=='off'&&s.width>0&&s.height>0,runOnJS:true,minDistance:0,maxPointers:1,
 onActivate:e=>{const h=guard.current();if(!h)return;active.current=true;erased.current.clear();store.setState({notice:null});if((h.mode==='pen'||h.mode==='highlighter')&&!renderInk&&pointCount>=4096){active.current=false;store.setState({notice:'Portable ink limit reached; clear ink or use the Graphite renderer'});return;}if(h.mode==='pen'||h.mode==='highlighter')store.setState(v=>({draft:{id:makeId.current(),tool:h.mode as 'pen'|'highlighter',color:h.color,size:h.size,points:[point(e)]},frame:v.frame+1}));else move(e);},
 onUpdate:move,onTouchesDown:e=>{if(e.numberOfTouches>1)cancel();},onDeactivate:e=>{if(e.canceled){cancel();return;}if(!active.current)return;move(e);if(!active.current)return;const v=store.getState(),ids=[...erased.current];active.current=false;erased.current.clear();store.setState(s=>({draft:undefined,frame:s.frame+1}));if(v.draft)void guard.run('stroke',(h,signal)=>h.onStrokeCommit(v.draft!,signal));else if(ids.length)void guard.run('erase',(h,signal)=>h.onRemoveStrokes(ids,signal));},onFinalize:e=>{if(e.canceled)cancel();},
 });
 const frame:PresenterInkFrame={strokes:[...strokes,...(s.draft?[s.draft]:[])],laser:s.laser,width:s.width,height:s.height,frame:s.frame};
 return <GestureDetector gesture={gesture} touchAction="none"><View {...rest} collapsable={false} pointerEvents={mode==='off'||off?'none':'auto'} focusable={mode!=='off'&&!off} accessibilityLabel={presenterModeStatus(mode)}
 {...{onKeyDown:(event:unknown)=>{const h=guard.current();if(!h)return;const k=webKey(event),command=resolvePresenterInkKey(k);if(!command)return;k.preventDefault();if(command.type==='exit'){cancel();h.onModeChange('off');}else if(command.type==='tool')h.onModeChange(command.tool);else{const last=h.strokes.at(-1);if(last)void guard.run('undo',(p,signal)=>p.onRemoveStrokes([last.id],signal));}}}}
 onLayout={e=>{store.setState({width:e.nativeEvent.layout.width,height:e.nativeEvent.layout.height});rest.onLayout?.(e);}} style={[{position:'absolute',left:0,top:0,right:0,bottom:0,overflow:'hidden',direction:'ltr'},style]}>
 {renderInk?renderInk(frame):<>{frame.strokes.map(stroke=><View key={stroke.id} pointerEvents="none" needsOffscreenAlphaCompositing={stroke.tool==='highlighter'} style={{position:'absolute',left:0,right:0,top:0,bottom:0,opacity:stroke.tool==='highlighter'?HIGHLIGHTER_OPACITY:1}}>{strokeSegments(stroke,frame).map((segment,index)=><View key={index} style={{position:'absolute',left:segment.left,top:segment.top,width:segment.length,height:segment.thickness,borderRadius:segment.thickness/2,backgroundColor:stroke.color,transform:[{rotate:segment.angle+'deg'}]}}/>)}</View>)}{s.laser?<View pointerEvents="none" {...{className:unstyled?undefined:'bg-danger'}} style={{position:'absolute',left:s.laser.x*s.width-5,top:s.laser.y*s.height-5,width:10,height:10,borderRadius:5}}/>:null}</>}
 {s.notice?<Text {...{className:unstyled?undefined:'text-text bg-surface-raised'}}>{s.notice}</Text>:null}<ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/>
 </View></GestureDetector>;
}
function makeStore(){return createStore(()=>({width:0,height:0,draft:undefined as PresenterInkStroke|undefined,laser:undefined as PresenterInkPoint|undefined,frame:0,notice:null as string|null}));}
