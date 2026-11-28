import {useEffect,useLayoutEffect,useMemo,useRef,type ComponentRef,type ReactNode} from 'react';
import {Platform,View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture,usePinchGesture,useSimultaneousGestures} from 'react-native-gesture-handler';
import {createStore,type StoreApi} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {shellKey} from '@nyc-tron/ui/components/shell/shell-keys';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import type {Rect2D} from '@nyc-tron/ui/components/overlays/popover-position';
import {validateViewport,validateDocRect,type CanvasViewport,type DocPoint,type DocRect} from './canvas-viewport.ts';
import {CanvasGestureRelations} from '@nyc-tron/ui/components/gestures/canvas-gesture-relations';
import {canvasFromTouches,canvasFromWheel,fitCanvas,panCanvasBy,sameCanvasView,validateZoomLimits,zoomCanvasAt} from './canvas-pan-zoom-model.ts';
export type {CanvasViewport,DocRect} from './canvas-viewport.ts';
export interface CanvasPanZoomProps extends Omit<ViewProps,'children'> {
 /** Document/viewport identity. Resources and authoritative document state stay above this control. */
 scope:string;revision?:string|number;
 viewport:CanvasViewport;
 onPreview?:(viewport:CanvasViewport)=>void;
 /** One call per completed touch/wheel gesture or keyboard/accessibility command. */
 onCommit:(viewport:CanvasViewport)=>void;
 /** Render using this viewport so previews do not become authoritative host state. */
 children:(viewport:CanvasViewport)=>ReactNode;
 minZoom?:number;maxZoom?:number;
 contentBounds?:DocRect;fitPadding?:number;
 keyboardStep?:number;
 /** Enable for an app's pan tool. Otherwise a single pointer remains available to document editing. */
 panWithOnePointer?:boolean;
 /** Local overlay coordinates; get nonoccluded panes from the existing layout owner. */
 usableRegions?:readonly Rect2D[];
 disabled?:boolean;label?:string;className?:string;unstyled?:boolean;
}
type Frame={x:number;y:number;width:number;height:number};
type Touch={id:number;absoluteX:number;absoluteY:number};
type GestureSession={kind:'touch'|'wheel';boundary:string;from:CanvasViewport;value:CanvasViewport;points:readonly DocPoint[];ids:readonly number[]};
type Wheel={clientX:number;clientY:number;deltaX:number;deltaY:number;deltaMode:number;ctrlKey?:boolean;metaKey?:boolean;preventDefault:()=>void;target?:{closest?:(selector:string)=>unknown}};
type WebHost={focus?:()=>void;getBoundingClientRect?:()=>{left:number;top:number;width:number;height:number};addEventListener?:(type:string,listener:(e:Wheel)=>void,options?:{passive:boolean})=>void;removeEventListener?:(type:string,listener:(e:Wheel)=>void)=>void};
const contains=(r:Rect2D,p:DocPoint)=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height;
const WHEEL_IDLE_MS=120;
/**
 * Native RNGH v3 pan/pinch recognition, non-passive browser wheel, and keyboard/accessibility
 * navigation. Mount under GestureHandlerRootView. The render callback owns scene drawing;
 * this component never applies a second transform or stores a document/renderer handle.
 */
export function CanvasPanZoom({scope,revision=0,viewport,onPreview,onCommit,children,minZoom=0.01,maxZoom=128,contentBounds,fitPadding=16,keyboardStep=32,panWithOnePointer=false,usableRegions,disabled=false,label='Canvas view',className,unstyled=false,style,onLayout,...rest}:CanvasPanZoomProps){
 validateViewport(viewport);validateZoomLimits({minZoom,maxZoom});
 if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512||!label.trim())throw new RangeError('Invalid canvas interaction identity');
 if(![fitPadding,keyboardStep].every(Number.isFinite)||fitPadding<0||keyboardStep<=0)throw new RangeError('Invalid canvas navigation geometry');
 if(contentBounds){validateDocRect(contentBounds);if(contentBounds.w<=0||contentBounds.h<=0)throw new RangeError('Canvas content bounds need positive area');}
 const regions=usableRegions??[{x:0,y:0,width:viewport.width,height:viewport.height}];
 if(regions.length>256||regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<0||r.height<0))throw new RangeError('Invalid canvas usable regions');
 const off=disabled||viewport.width<=0||viewport.height<=0||!regions.some(r=>r.width>0&&r.height>0);
 const boundary=JSON.stringify([scope,revision,off,viewport,minZoom,maxZoom,contentBounds,fitPadding,keyboardStep,panWithOnePointer,regions]);
 const local=useRef<StoreApi<{preview:CanvasViewport|undefined}>|null>(null);local.current??=createStore(()=>({preview:undefined}));
 const store=local.current,preview=useStore(store,s=>s.preview),host=useRef<ComponentRef<typeof View>|null>(null);
 const touchActive=useRef(false),touchOwners=useRef(new Map<number,string>()),touchStart=useRef<{boundary:string;from:CanvasViewport;points:readonly (DocPoint&{id:number})[]}|null>(null);
 const mounted=useRef(false),frame=useRef<Frame|null>(null),measurement=useRef(0),touches=useRef<readonly Touch[]>([]),session=useRef<GestureSession|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const latest=useRef({boundary,off,viewport,onPreview,onCommit,minZoom,maxZoom,contentBounds,fitPadding,keyboardStep,regions});
 useLayoutEffect(()=>{latest.current={boundary,off,viewport,onPreview,onCommit,minZoom,maxZoom,contentBounds,fitPadding,keyboardStep,regions};});
 const current=()=>mounted.current&&!off&&latest.current.boundary===boundary?latest.current:null;
 const stopTimer=()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}};
 const cancel=()=>{const active=session.current;session.current=null;stopTimer();store.setState({preview:undefined});const p=latest.current;if(active&&mounted.current&&!p.off&&active.boundary===p.boundary)p.onPreview?.(p.viewport);};
 const finish=()=>{const active=session.current;session.current=null;stopTimer();store.setState({preview:undefined});const p=latest.current;if(!active||!mounted.current||p.off||active.boundary!==p.boundary)return;if(!sameCanvasView(active.from,active.value))p.onCommit(active.value);else p.onPreview?.(p.viewport);};
 const measure=()=>{const ticket=++measurement.current;host.current?.measureInWindow((x,y,width,height)=>{if(!mounted.current||ticket!==measurement.current||latest.current.boundary!==boundary||![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)return;const before=frame.current;if(before&&(before.x!==x||before.y!==y||before.width!==width||before.height!==height))cancel();frame.current={x,y,width,height};});};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;measurement.current++;session.current=null;stopTimer();};},[]);
 useLayoutEffect(()=>{touchActive.current=false;touchStart.current=null;touchOwners.current.clear();cancel();frame.current=null;measure();},[boundary]);
 const points=(values:readonly Touch[])=>{const at=frame.current,p=latest.current;if(!at)return null;return [...values].sort((a,b)=>a.id-b.id).map(t=>({id:t.id,x:(t.absoluteX-at.x)*p.viewport.width/at.width,y:(t.absoluteY-at.y)*p.viewport.height/at.height}));};
 const begin=()=>{const p=current(),values=points(touches.current);if(!p||!values||values.length!==(panWithOnePointer?1:2)&&values.length!==2||values.some(v=>!p.regions.some(r=>r.width>0&&r.height>0&&contains(r,v))))return;if(values.some(v=>touchOwners.current.get(v.id)!==p.boundary)||session.current?.kind==='touch')return;const start=touchStart.current;if(!start||start.boundary!==p.boundary||start.points.length!==values.length||start.points.some((v,i)=>v.id!==values[i]?.id||!p.regions.some(r=>r.width>0&&r.height>0&&contains(r,v))))return;cancel();session.current={kind:'touch',boundary:p.boundary,from:start.from,value:start.from,points:start.points,ids:start.points.map(v=>v.id)};store.setState({preview:p.viewport});if(Platform.OS==='web')(host.current as unknown as WebHost|null)?.focus?.();};
 const move=()=>{const p=current(),active=session.current,values=points(touches.current);if(!p||active?.kind!=='touch'||active.boundary!==p.boundary)return;if(!values||values.length!==active.ids.length||values.some((v,i)=>v.id!==active.ids[i])){cancel();return;}const value=canvasFromTouches(active.from,active.points,values,p);active.value=value;store.setState({preview:value});p.onPreview?.(value);};
 const cancelTouch=()=>{touchActive.current=false;touchStart.current=null;for(const t of touches.current)touchOwners.current.set(t.id,'');if(session.current?.kind==='touch')cancel();};
 const activate=()=>{if(!current())return;touchActive.current=true;begin();};
 const pan=usePanGesture({enabled:!off,runOnJS:true,minDistance:0,minPointers:panWithOnePointer?1:2,maxPointers:2,averageTouches:true,enableTrackpadTwoFingerGesture:true,
  onTouchesDown:event=>{const p=current();if(!p)return;for(const touch of event.changedTouches)touchOwners.current.set(touch.id,p.boundary);touches.current=event.allTouches;const initial=points(event.allTouches);if(event.numberOfTouches>2||session.current?.kind==='touch'&&event.numberOfTouches!==session.current.ids.length)cancelTouch();else{if(initial&&(initial.length===2||panWithOnePointer&&initial.length===1)&&initial.every(t=>touchOwners.current.get(t.id)===p.boundary))touchStart.current={boundary:p.boundary,from:p.viewport,points:initial};if(touchActive.current&&!session.current)begin();}},
  onActivate:activate,onTouchesMove:event=>{if(!current())return;touches.current=event.allTouches;if(touchActive.current&&!session.current)begin();move();},
  onTouchesUp:event=>{if(!current())return;const ended=new Set(event.changedTouches.map(t=>t.id));touches.current=event.allTouches.filter(t=>!ended.has(t.id));for(const id of ended)touchOwners.current.delete(id);touchActive.current=false;touchStart.current=null;if(session.current?.kind==='touch')finish();},onTouchesCancel:()=>{if(!current())return;touchOwners.current.clear();touches.current=[];cancelTouch();},
  onDeactivate:event=>{if(!current())return;if(session.current?.kind==='touch'){if(event.canceled)cancelTouch();else finish();}},onFinalize:event=>{if(!current())return;if(event.canceled)cancelTouch();}});
 const pinch=usePinchGesture({enabled:!off,runOnJS:true,onActivate:activate});
 const gesture=useSimultaneousGestures(pan,pinch),relations=useMemo(()=>({gestures:[pan,pinch],onePointerPan:panWithOnePointer}),[pan,pinch,panWithOnePointer]);
 const wheel=(event:Wheel)=>{const p=current(),node=host.current as unknown as WebHost|null,rect=node?.getBoundingClientRect?.();if(!p||!rect||rect.width<=0||rect.height<=0||event.target?.closest?.('input,textarea,select,[contenteditable="true"]')||![0,1,2].includes(event.deltaMode))return;
  const anchor={x:(event.clientX-rect.left)*p.viewport.width/rect.width,y:(event.clientY-rect.top)*p.viewport.height/rect.height};if(!p.regions.some(r=>r.width>0&&r.height>0&&contains(r,anchor)))return;
  if(session.current?.kind==='touch'){cancelTouch();return;}let active=session.current;if(!active){active={kind:'wheel',boundary:p.boundary,from:p.viewport,value:p.viewport,points:[],ids:[]};session.current=active;}
  if(active.boundary!==p.boundary)return;event.preventDefault();active.value=canvasFromWheel(active.value,{deltaX:event.deltaX,deltaY:event.deltaY,deltaMode:event.deltaMode as 0|1|2,zoom:!!(event.ctrlKey||event.metaKey),anchor},p);store.setState({preview:active.value});p.onPreview?.(active.value);stopTimer();timer.current=setTimeout(finish,WHEEL_IDLE_MS);
 };
 const wheelCallback=useRef(wheel);useLayoutEffect(()=>{wheelCallback.current=wheel;});
 useEffect(()=>{if(Platform.OS!=='web')return;const node=host.current as unknown as WebHost|null;const listener=(event:Wheel)=>wheelCallback.current(event);node?.addEventListener?.('wheel',listener,{passive:false});return()=>node?.removeEventListener?.('wheel',listener);},[]);
 const command=(action:string)=>{const p=current();if(!p)return;if(session.current?.kind==='touch')cancelTouch();else cancel();const center={x:p.viewport.width/2,y:p.viewport.height/2};let next:CanvasViewport;
  switch(action){case 'increment':next=zoomCanvasAt(p.viewport,p.viewport.zoom*1.25,center,p);break;case 'decrement':next=zoomCanvasAt(p.viewport,p.viewport.zoom/1.25,center,p);break;case 'actualSize':next=zoomCanvasAt(p.viewport,1,center,p);break;case 'fit':if(!p.contentBounds||p.viewport.width<=2*p.fitPadding||p.viewport.height<=2*p.fitPadding)return;next=fitCanvas(p.viewport,p.contentBounds,p.fitPadding,p);break;case 'panLeft':next=panCanvasBy(p.viewport,p.keyboardStep,0);break;case 'panRight':next=panCanvasBy(p.viewport,-p.keyboardStep,0);break;case 'panUp':next=panCanvasBy(p.viewport,0,p.keyboardStep);break;case 'panDown':next=panCanvasBy(p.viewport,0,-p.keyboardStep);break;default:return;}
  if(!sameCanvasView(p.viewport,next))p.onCommit(next);
 };
 const onKeyDown=(event:unknown)=>{const k=shellKey(event);if(k.key==='Escape'){if(current()){k.preventDefault();if(session.current?.kind==='touch')cancelTouch();else cancel();}return;}if(k.altKey||k.ctrlKey||k.metaKey)return;const actions:Record<string,string>={'+':'increment','=':'increment','-':'decrement','_':'decrement','0':'fit',Home:'fit','1':'actualSize',ArrowLeft:'panLeft',ArrowRight:'panRight',ArrowUp:'panUp',ArrowDown:'panDown'};if(Object.hasOwn(actions,k.key)){k.preventDefault();command(actions[k.key]!);}};
 const shown=preview??viewport;
 return <GestureDetector gesture={gesture} touchAction="none" userSelect="none"><View {...rest} ref={host} collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{disabled:off}}
  accessibilityValue={{min:minZoom*100,max:maxZoom*100,now:shown.zoom*100,text:'Zoom '+Number((shown.zoom*100).toFixed(2))+' percent'}}
  accessibilityActions={off?[]:[{name:'increment',label:'Zoom in'},{name:'decrement',label:'Zoom out'},{name:'actualSize',label:'Actual size'},...(contentBounds?[{name:'fit',label:'Fit document'}]:[]),{name:'panLeft',label:'Pan left'},{name:'panRight',label:'Pan right'},{name:'panUp',label:'Pan up'},{name:'panDown',label:'Pan down'}]}
  onAccessibilityAction={event=>command(event.nativeEvent.actionName)} onLayout={event=>{measure();onLayout?.(event);}}
  {...(Platform.OS==='web'?{onKeyDown,tabIndex:off?-1:0,onPointerEnter:measure}:{})}
  {...{className:joinClasses(!unstyled&&'focus-visible:ring-2 focus-visible:ring-focus',className)}} style={[{width:viewport.width,height:viewport.height,overflow:'hidden',direction:'ltr'},style]}>{<CanvasGestureRelations.Provider value={relations}>{children(shown)}</CanvasGestureRelations.Provider>}</View></GestureDetector>;
}
