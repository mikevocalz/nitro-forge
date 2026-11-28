import {useContext,useLayoutEffect,useRef} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {GestureDetector,PointerType,usePanGesture} from 'react-native-gesture-handler';
import {Skia,StrokeCap} from 'react-native-skia';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {GPUCanvasViewport} from '../canvas/GPUCanvasViewport.tsx';
import {CanvasGestureRelations} from '@nyc-tron/ui/components/gestures/canvas-gesture-relations';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {createFrameThrottle,type FrameThrottle} from '../frame-throttle.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {MAX_INK_PREVIEW_SAMPLES,validateInkSamples,type InkSample} from './brush-model.ts';
export interface InkStrokePreviewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 width:number;height:number;strokeWidth:number;inkColor:string;
 /** External/native-adapter samples. Omit for the local test pad. */
 samples?:readonly InkSample[];
 onStroke?:(samples:readonly InkSample[],signal?:AbortSignal)=>void|Promise<unknown>;
 onSamples?:(samples:readonly InkSample[]|undefined)=>void;
 /** Optional position filter. Pressure, tilt, twist and timestamps must be preserved. */
 filterSamples?:(samples:readonly InkSample[])=>readonly InkSample[];
 /** Measured end-to-end latency from the host's presentation clock; never inferred from RN receipt time. */
 latencyMs?:number;unstyled?:boolean;
}
type SampleEvent={x:number;y:number;pointerType:PointerType;stylusData?:{pressure:number;tiltX:number;tiltY:number}};
/** A bounded pressure-sensitive Graphite test stroke, independent of the production brush engine. */
export function InkStrokePreview({scope='ink-test',revision=0,...props}:InkStrokePreviewProps){
 const {width,height,strokeWidth,inkColor,samples,onStroke:_stroke,onSamples:_samples,filterSamples,latencyMs,disabledReason,unstyled=false,style,...rest}=props;
 if(![width,height,strokeWidth].every(n=>Number.isFinite(n)&&n>0)||strokeWidth>4096||!inkColor.trim()||inkColor.length>4096||latencyMs!==undefined&&(!Number.isFinite(latencyMs)||latencyMs<0))throw new RangeError('Invalid ink test surface');
 if(samples)validateInkSamples(samples);
 const boundary=JSON.stringify([...controlIdentity(scope,revision),width,height,strokeWidth,inkColor,disabledReason]);
 const guard=useScopedControl(boundary,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined||samples!==undefined;
 const relations=useContext(CanvasGestureRelations),live=useRef<InkSample[]|null>(null),rejected=useRef(false);
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v);
 const latest=useRef({guard,props});useLayoutEffect(()=>{latest.current={guard,props};});
 const throttle=useRef<FrameThrottle<readonly InkSample[]>|null>(null);
 throttle.current??=createFrameThrottle(points=>{store.setState(v=>({points,frame:v.frame+1}));latest.current.guard.current()?.onSamples?.(points);});
 const cancel=()=>{live.current=null;throttle.current?.cancel();latest.current.guard.current()?.onSamples?.(undefined);};
 useLayoutEffect(()=>{cancel();store.setState(v=>({points:[],frame:v.frame+1}));return cancel;},[boundary,off]);
 useLayoutEffect(()=>{store.setState(v=>({frame:v.frame+1}));},[samples,filterSamples]);
 const append=(event:SampleEvent)=>{
  const points=live.current,p=latest.current.props;if(!points||rejected.current)return;
  if(![event.x,event.y].every(Number.isFinite)||event.x<0||event.y<0||event.x>p.width||event.y>p.height){cancel();return;}
  if(points.length>=MAX_INK_PREVIEW_SAMPLES){cancel();store.setState({notice:'Stroke limit reached; draw a shorter test stroke'});return;}
  const data=event.pointerType===PointerType.STYLUS?event.stylusData:undefined;
  const point:InkSample={x:event.x,y:event.y,timeMs:performance.now(),input:event.pointerType===PointerType.STYLUS?'pen':event.pointerType===PointerType.TOUCH?'touch':event.pointerType===PointerType.MOUSE?'mouse':'unknown',
   ...(data&&Number.isFinite(data.pressure)?{pressure:Math.min(1,Math.max(0,data.pressure))}:{}),...(data&&Number.isFinite(data.tiltX)?{tiltX:data.tiltX}:{}),...(data&&Number.isFinite(data.tiltY)?{tiltY:data.tiltY}:{})};
  points.push(point);throttle.current?.push([...points]);
 };
 const release=()=>{const points=live.current;live.current=null;if(!points||rejected.current)return;throttle.current?.flush();latest.current.guard.current()?.onSamples?.(undefined);if(points.length)void latest.current.guard.run('stroke',(host,signal)=>host.onStroke?.([...points],signal));};
 const gesture=usePanGesture({enabled:!off,runOnJS:true,minDistance:0,maxPointers:1,simultaneousWith:relations.gestures,
  onBegin:()=>{rejected.current=false;},onTouchesDown:event=>{if(event.numberOfTouches!==1){rejected.current=true;cancel();}},
  onActivate:event=>{if(rejected.current||!latest.current.guard.current())return;live.current=[];store.setState({notice:null});append(event);},
  onUpdate:append,onDeactivate:event=>{if(event.canceled)cancel();else{append(event);release();}},onTouchesCancel:()=>{rejected.current=true;cancel();},onFinalize:()=>{if(live.current)cancel();},
 });
 const raw=samples??s.points,points=filterSamples?filterSamples(raw):raw;validateInkSamples(points);
 if(filterSamples&&(points.length!==raw.length||points.some((p,i)=>{const source=raw[i]!;return p.pressure!==source.pressure||p.tiltX!==source.tiltX||p.tiltY!==source.tiltY||p.twist!==source.twist||p.timeMs!==source.timeMs||p.input!==source.input;})))throw new RangeError('Ink preview filter must preserve input measurements');
 const last=raw[raw.length-1],metric=(n:number|undefined,suffix='')=>n===undefined?'Not reported':n.toFixed(2)+suffix;
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Test stroke">
  <GestureDetector gesture={gesture} touchAction="none" userSelect="none"><View collapsable={false} style={{width,height}}>
   <GPUCanvasViewport scope={scope} revision={s.frame} viewport={{width,height,zoom:1,panX:0,panY:0}} unstyled={unstyled} label="Ink test stroke" drawFrame={canvas=>{
    const paint=Skia.Paint();try{paint.setColor(Skia.Color(inkColor));paint.setStrokeCap(StrokeCap.Round);
     for(let i=0;i<points.length;i++){const p=points[i]!,previous=points[i-1];const size=Math.max(.1,strokeWidth*(p.pressure??1));paint.setStrokeWidth(size);if(previous)canvas.drawLine(previous.x,previous.y,p.x,p.y,paint);else canvas.drawCircle(p.x,p.y,size/2,paint);}
    }finally{paint.dispose();}
   }}/>
  </View></GestureDetector>
  <Text {...{className:unstyled?undefined:'text-text'}}>{raw.length} samples; input: {last?.input??'None'}</Text>
  <Text {...{className:unstyled?undefined:'text-text'}}>Pressure: {metric(last?.pressure)}; tilt X: {metric(last?.tiltX,'°')}; tilt Y: {metric(last?.tiltY,'°')}; twist: {metric(last?.twist,'°')}</Text>
  <Text {...{className:unstyled?undefined:'text-text'}}>Measured presentation latency: {latencyMs===undefined?'Not reported':latencyMs.toFixed(1)+' ms'}</Text>
  {s.notice?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{s.notice}</Text>:null}
  {disabledReason||guard.pending?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Committing test stroke'}</Text>:null}
  {samples===undefined?<Button title="Clear test stroke" variant="secondary" disabled={guard.pending} unstyled={unstyled} onPress={()=>{cancel();store.setState(v=>({points:[],frame:v.frame+1,notice:null}));}}/>:null}
  <ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
function makeStore(){return createStore(()=>({points:[] as readonly InkSample[],frame:0,notice:null as string|null}));}
