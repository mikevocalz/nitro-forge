import {useEffect,useMemo,useRef} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {assertHsv,hsvToRgb,rgbaToHex,type HsvColor} from "../color.ts";
import {pointToHsv} from "./fieldGeometry.ts";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";
import {keyboardKey} from "@nyc-tron/ui/components/gestures/drag-transport";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {bounded} from "./color-adjustments.ts";
import { tokens } from "../tokens.ts";

/** Centre of each of the 48 gradient strips as a fraction of the field (strip i spans i/48 to (i+1)/48). */
const STRIP_CENTRES=Array.from({length:48},(_,i)=>(i+.5)/48);
/** Standalone saturation/value field; hue and alpha remain with the host. */
export interface SVColorFieldProps extends Omit<ViewProps,'children'> {readonly value:HsvColor;readonly onPreview?:(value:HsvColor)=>void;readonly onCommit:(value:HsvColor)=>void;readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean}
type Local={width:number;preview:HsvColor|null};
/** Two-dimensional saturation/value field with one commit on release and cancellation restoration. */
export function SVColorField({value,onPreview,onCommit,height=180,disabled=false,unstyled=false,...props}:SVColorFieldProps){
 assertHsv(value);bounded(height,88,600,'Color field height');
 const local=useRef<StoreApi<Local>|null>(null);local.current??=createStore<Local>(()=>({width:0,preview:null}));const store=local.current,state=useStore(store,s=>s);
 const latest=useRef({value,onPreview,onCommit,disabled});latest.current={value,onPreview,onCommit,disabled};
 const gesture=useMemo(()=>createValueGesture<HsvColor>({disabled:()=>latest.current.disabled,equals:(a,b)=>a.h===b.h&&a.s===b.s&&a.v===b.v&&a.alpha===b.alpha,preview:color=>{store.setState({preview:color});latest.current.onPreview?.(color);},commit:color=>latest.current.onCommit(color)}),[store]);
 const cancel=()=>{gesture.cancel();store.setState({preview:null});};
 useEffect(()=>{if(disabled)cancel();},[disabled,gesture]);useEffect(()=>()=>gesture.cancel(),[gesture]);
 const update=(point:{x:number;y:number})=>{if(state.width>44)gesture.update(pointToHsv({x:point.x-22,y:point.y-22},{width:state.width-tokens.spacing.fixedTarget,height:height-tokens.spacing.fixedTarget},latest.current.value));};
 const handlers=useLocalPointer({disabled:disabled||state.width<=44,onBegin:p=>{gesture.begin(latest.current.value);update(p);},onMove:update,onRelease:p=>{update(p);gesture.release();store.setState({preview:null});},onCancel:cancel});
 const change=(s:number,v:number)=>{if(!disabled&&(s!==value.s||v!==value.v))onCommit({...value,s:Math.max(0,Math.min(1,s)),v:Math.max(0,Math.min(1,v))});};
 const shown=state.preview??value,base=rgbaToHex(hsvToRgb({h:shown.h,s:1,v:1,alpha:1}),false),white=rgbaToHex({r:255,g:255,b:255,alpha:1},false),black=rgbaToHex({r:0,g:0,b:0,alpha:1},false);
 const onKeyDown=(event:unknown)=>{const key=keyboardKey(event as Parameters<typeof keyboardKey>[0]);if(key==='Escape'){cancel();return;}let s=value.s,v=value.v;if(key==='ArrowLeft')s-=.01;else if(key==='ArrowRight')s+=.01;else if(key==='ArrowUp')v+=.01;else if(key==='ArrowDown')v-=.01;else return;(event as {preventDefault?:()=>void}).preventDefault?.();change(s,v);};
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <View {...handlers} onLayout={e=>store.setState({width:e.nativeEvent.layout.width})} accessible accessibilityRole="adjustable" accessibilityLabel="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown.v*100)} aria-valuetext={`Saturation ${Math.round(shown.s*100)} percent, brightness ${Math.round(shown.v*100)} percent`} aria-disabled={disabled}
   accessibilityActions={[{name:'increment',label:'Increase brightness'},{name:'decrement',label:'Decrease brightness'},{name:'increaseSaturation',label:'Increase saturation'},{name:'decreaseSaturation',label:'Decrease saturation'}]}
   onAccessibilityAction={e=>{const a=e.nativeEvent.actionName;if(a==='increment')change(value.s,value.v+.01);if(a==='decrement')change(value.s,value.v-.01);if(a==='increaseSaturation')change(value.s+.01,value.v);if(a==='decreaseSaturation')change(value.s-.01,value.v);}}
   {...{focusable:!disabled,onKeyDown,className:joinClasses(!unstyled&&'focus-visible:ring-2 focus-visible:ring-focus')}} style={{height,...(Platform.OS==='web'?{userSelect:'none',touchAction:'none'}:{})} as object}>
   <View pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden style={{position:'absolute',left:tokens.spacing.off22,right:tokens.spacing.off22,top:tokens.spacing.off22,bottom:tokens.spacing.off22}}>
    {/* Two bounded 48-strip layers compose S and V without optional native peers. */}
    <View style={{position:'absolute',inset:0,backgroundColor:base}}/>
    {STRIP_CENTRES.map((centre,i)=><View key={`s${i}`} style={{position:'absolute',left:`${i/48*100}%`,top:0,bottom:0,width:`${100/48+.02}%`,backgroundColor:white,opacity:1-centre}}/>)}
    {STRIP_CENTRES.map((centre,i)=><View key={`v${i}`} style={{position:'absolute',top:`${i/48*100}%`,left:0,right:0,height:`${100/48+.02}%`,backgroundColor:black,opacity:centre}}/>)}
    <View {...{className:joinClasses(!unstyled&&'border-text')}} style={{position:'absolute',left:`${shown.s*100}%`,top:`${(1-shown.v)*100}%`,width:tokens.spacing.fixedSection,height:tokens.spacing.fixedSection,marginLeft:-tokens.spacing.fixedInset,marginTop:-tokens.spacing.fixedInset,borderWidth:tokens.borderWidth.strong,borderRadius:tokens.spacing.fixedSection / 2, /* radius-exempt: colour-well */backgroundColor:rgbaToHex(hsvToRgb({...shown,alpha:1}),false)}}/>
   </View>
  </View>
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Saturation {Math.round(shown.s*100)}%, brightness {Math.round(shown.v*100)}%</Text>
 </View>;
}
