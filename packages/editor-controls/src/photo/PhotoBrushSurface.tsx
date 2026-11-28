import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {Platform,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {useLocalPointer} from '@nyc-tron/ui/components/gestures/useLocalPointer';
import {keyboardKey,type KeyEventLike} from '@nyc-tron/ui/components/gestures/drag-transport';
import {createFrameThrottle,type FrameThrottle} from '../frame-throttle.ts';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {MAX_PHOTO_BRUSH_POINTS,photoBrushPoint,validatePhotoBrushPoints,validatePhotoImageSize,type PhotoBrushPoint,type PhotoImageSize} from './photo-masks.ts';
export interface PhotoBrushSurfaceProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly imageSize:PhotoImageSize;readonly radiusPixels:number;readonly onCommit:(points:readonly PhotoBrushPoint[])=>void;
 readonly onPreview?:(points:readonly PhotoBrushPoint[]|undefined)=>void;readonly children?:ReactNode;readonly disabled?:boolean;readonly unstyled?:boolean;readonly label?:string;
}
const makeStore=()=>createStore(()=>({width:0,height:0,draft:null as readonly PhotoBrushPoint[]|null,preview:[] as readonly PhotoBrushPoint[],error:null as string|null}));
/** Single shared native responder for mask/retouch tools. A bounded path preview,
 * not an image-processing substitute. Original pixels are supplied by the host. */
export function PhotoBrushSurface({scope,imageSize,radiusPixels,onCommit,onPreview,children,disabled=false,unstyled=false,label='Photo brush surface',...props}:PhotoBrushSurfaceProps){
 validatePhotoImageSize(imageSize);if(!Number.isFinite(radiusPixels)||radiusPixels<.5||radiusPixels>4096||!scope.trim())throw new RangeError('Invalid brush surface scope or radius');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current;
 const preview=useStore(store,s=>s.preview),width=useStore(store,s=>s.width),height=useStore(store,s=>s.height),error=useStore(store,s=>s.error);
 const latest=useRef({scope,onCommit,onPreview,disabled});latest.current={scope,onCommit,onPreview,disabled};
 const throttle=useRef<FrameThrottle<readonly PhotoBrushPoint[]>|null>(null);throttle.current??=createFrameThrottle(points=>{store.setState({preview:points});latest.current.onPreview?.(points);});
 const cancel=()=>{throttle.current!.cancel();const active=store.getState().draft!==null;store.setState({draft:null,preview:[],error:null});if(active)latest.current.onPreview?.(undefined);};
 useLayoutEffect(()=>{cancel();return cancel;},[scope,disabled,imageSize.width,imageSize.height]);
 const add=(p:{x:number;y:number;pressure?:number})=>{const s=store.getState();if(!s.draft||s.width<=0||s.height<=0)return;const point=photoBrushPoint(p.x,p.y,s.width,s.height,p.pressure),last=s.draft.at(-1);if(last&&last.x===point.x&&last.y===point.y&&last.pressure===point.pressure)return;if(s.draft.length>=MAX_PHOTO_BRUSH_POINTS){cancel();store.setState({error:'Stroke limit reached; use shorter strokes.'});return;}const points=[...s.draft,point];store.setState({draft:points});throttle.current!.push(points);};
 const handlers=useLocalPointer({disabled,onBegin:p=>{const s=store.getState();if(latest.current.disabled||s.width<=0||s.height<=0)return;const points=[photoBrushPoint(p.x,p.y,s.width,s.height,p.pressure)];store.setState({draft:points,error:null});throttle.current!.push(points);},onMove:add,onRelease:p=>{if(latest.current.disabled){cancel();return;}add(p);const points=store.getState().draft;throttle.current!.cancel();store.setState({draft:null,preview:[]});latest.current.onPreview?.(undefined);if(points){validatePhotoBrushPoints(points);latest.current.onCommit(points);}},onCancel:cancel});
 const stride=Math.max(1,Math.ceil(preview.length/256));const shown=preview.filter((_,index)=>index%stride===0||index===preview.length-1),diameter=Math.max(1,2*radiusPixels*width/imageSize.width);
 return <View {...props} style={[{gap:4},props.style]}>
  <View {...handlers} focusable={!disabled} accessibilityLabel={label} {...{onKeyDown:(event:KeyEventLike)=>{if(keyboardKey(event)==='Escape')cancel();}}} onLayout={event=>{const {width,height}=event.nativeEvent.layout;store.setState({width,height});cancel();}} style={{width:'100%',aspectRatio:imageSize.width/imageSize.height,overflow:'hidden',...(Platform.OS==='web'?{touchAction:'none'}:{}),opacity:disabled?.5:1}}>
   <View pointerEvents="none" style={{position:'absolute',inset:0}}>{children}</View>
   {shown.map((point,index)=>{const previous=shown[index-1]??point,dx=(point.x-previous.x)*width,dy=(point.y-previous.y)*height;return <View key={index} pointerEvents="none" style={{position:'absolute',left:previous.x*width-diameter/2,top:previous.y*height-diameter/2,width:Math.hypot(dx,dy)+diameter,height:diameter,borderRadius:diameter/2,backgroundColor:'rgba(80,180,255,0.5)',transformOrigin:`${diameter/2}px ${diameter/2}px`,transform:[{rotate:`${Math.atan2(dy,dx)}rad`}]}}/>;})}
  </View>
  {error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-danger')}}>{error}</Text>:null}
 </View>;
}
