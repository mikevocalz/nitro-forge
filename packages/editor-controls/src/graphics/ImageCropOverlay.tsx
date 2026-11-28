import {cancelPreview} from "../cancel-preview.ts";
import {useLayoutEffect,useRef,type ReactNode} from "react";
import {Text,View,type ViewProps} from "react-native";
import {GestureDetector} from "react-native-gesture-handler";
import {useEditorPan} from "@nyc-tron/ui/components/gestures/useEditorPan";
import {keyboardKey} from "@nyc-tron/ui/components/gestures/drag-transport";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {moveCrop,resizeCrop,resizeCropWithAspect,type CropRect,type CropCorner,validateCrop} from "./crop.ts";
import {joinClasses} from "@nyc-tron/ui/components/styles";

export interface ImageCropOverlayProps extends Omit<ViewProps,"children">{
 scope?:string;revision?:string|number;disabled?:boolean;
 /** Ratio in normalized image coordinates, supplied by the host. */
 aspectRatio?:number;grid?:"thirds"|"center"|"none";
 rect:CropRect;
 width:number;
 height:number;
 onPreview?:(rect:CropRect)=>void;
 onCommit:(rect:CropRect)=>void|Promise<unknown>;
 /** Optional override; defaults to the theme's accent token. */
 accentColor?:string;
 /** Normalized distance per screen-reader move/resize action. */
 accessibilityStep?:number;
 className?:string;
 unstyled?:boolean;
 children?:ReactNode;
}
type Local={preview:CropRect;active:boolean};
/** Native interactive crop overlay only. Call Prism to apply pixels non-destructively. */
export function ImageCropOverlay({
 scope="crop",revision=0,disabled=false,aspectRatio,grid="thirds",rect,width,height,onPreview,onCommit,accentColor,accessibilityStep=0.02,className,unstyled=false,children,...rest
}:ImageCropOverlayProps){
 validateCrop(rect);
 if(![width,height].every(Number.isFinite)||width<=0||height<=0)throw new RangeError("Invalid crop viewport");
 if(!Number.isFinite(accessibilityStep)||accessibilityStep<=0||accessibilityStep>1||aspectRatio!==undefined&&(!Number.isFinite(aspectRatio)||aspectRatio<=0))throw new RangeError("Invalid crop controls");
 const latest=useRef({rect,width,height,onPreview,onCommit,disabled});
 useLayoutEffect(()=>{latest.current={rect,width,height,onPreview,onCommit,disabled};});
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({preview:rect,active:false}));
 const store=local.current;
 const active=useStore(store,s=>s.active);
 const preview=useStore(store,s=>s.preview);
 const displayed=active?preview:rect;
 const gestureStart=useRef(rect);
 const announce=(next:CropRect)=>{
  store.setState({preview:next,active:true});
  latest.current.onPreview?.(next);
 };
 const commit=(next:CropRect)=>{
  if(latest.current.disabled)return;
  store.setState({preview:next,active:false});
  if(JSON.stringify(next)!==JSON.stringify(latest.current.rect))void latest.current.onCommit(next);
 };
 const cancel=()=>cancelPreview(latest.current.rect,preview=>store.setState({active:false,preview}),latest.current.onPreview);
 const release=()=>{if(store.getState().active)commit(store.getState().preview);};
 const begin=()=>{gestureStart.current=latest.current.rect;store.setState({active:true,preview:gestureStart.current});};
 const drag=(dx:number,dy:number)=>announce(moveCrop(gestureStart.current,dx/latest.current.width,dy/latest.current.height));
 useLayoutEffect(()=>{store.setState({active:false,preview:latest.current.rect});},[scope,revision,width,height,aspectRatio,disabled]);
 const boundary=JSON.stringify([scope,revision,width,height,aspectRatio,disabled,rect]);
 const pan=useEditorPan({disabled,boundary,onBegin:begin,onMove:drag,onRelease:release,onCancel:cancel});
 const onKeyDown=(event:{key?:string;shiftKey?:boolean;preventDefault?:()=>void})=>{
  const key=keyboardKey(event);if(disabled)return;
  if(key==='Escape'){event.preventDefault?.();cancel();return;}
  const amount=accessibilityStep*(event.shiftKey?5:1);
  const delta=key==='ArrowLeft'?[-amount,0]:key==='ArrowRight'?[amount,0]:key==='ArrowUp'?[0,-amount]:key==='ArrowDown'?[0,amount]:null;
  if(!delta)return;event.preventDefault?.();commit(moveCrop(latest.current.rect,delta[0]!,delta[1]!));
 };
 const styled=!unstyled;
 const accentBorder=accentColor?{borderColor:accentColor}:null;
 const accentFill=accentColor?{backgroundColor:accentColor}:null;
 const accentBorderClass=styled&&!accentColor?"border-accent":undefined;
 const accentFillClass=styled&&!accentColor?"bg-accent":undefined;
 // Screen-reader path: a discrete move/resize is one committed command.
 const step=accessibilityStep;
 const moveBy=(dx:number,dy:number)=>commit(moveCrop(latest.current.rect,dx,dy));
 const pct=(n:number)=>Math.round(n*100)+"%";
 const guide=(pos:object)=><View pointerEvents="none" {...{className:accentFillClass}}
   style={{position:"absolute",opacity:0.35,...accentFill,...pos}}/>;
 return <View {...rest} {...{className:joinClasses("overflow-hidden",className)}}
   accessibilityLabel="Crop canvas" style={[{width,height,position:"relative"},rest.style]}>
   {children}
   <GestureDetector gesture={pan} touchAction="none" userSelect="none"><View {...{onKeyDown,focusable:!disabled}} accessible accessibilityRole="adjustable"
     accessibilityLabel="Crop rectangle" accessibilityState={{disabled}} accessibilityHint="Drag to move, or use the actions menu to move or resize"
     accessibilityValue={{text:`${pct(displayed.width)} by ${pct(displayed.height)}, left ${pct(displayed.x)}, top ${pct(displayed.y)}`}}
     accessibilityActions={[
       {name:"increment",label:"Move right"},{name:"decrement",label:"Move left"},
       {name:"moveUp",label:"Move up"},{name:"moveDown",label:"Move down"},
       {name:"grow",label:"Enlarge crop"},{name:"shrink",label:"Shrink crop"},
     ]}
     onAccessibilityAction={e=>{
       if(disabled)return;const r=latest.current.rect;
       switch(e.nativeEvent.actionName){
         case "increment":moveBy(step,0);break;
         case "decrement":moveBy(-step,0);break;
         case "moveUp":moveBy(0,-step);break;
         case "moveDown":moveBy(0,step);break;
         case "grow":commit(resizeCropWithAspect(r,"se",step,step,aspectRatio));break;
         case "shrink":commit(resizeCropWithAspect(r,"se",-step,-step,aspectRatio));break;
       }
     }}
     {...{className:accentBorderClass}}
     style={{position:"absolute",left:displayed.x*width,top:displayed.y*height,
       width:displayed.width*width,height:displayed.height*height,
       borderWidth:2,...accentBorder,backgroundColor:"transparent"}}>
     {grid==="thirds"?guide({left:"33.33%",top:0,bottom:0,width:1}):null}
     {grid==="thirds"?guide({left:"66.66%",top:0,bottom:0,width:1}):null}
     {grid==="thirds"?guide({top:"33.33%",left:0,right:0,height:1}):null}
     {grid==="thirds"?guide({top:"66.66%",left:0,right:0,height:1}):null}
     {grid==="center"?<>{guide({left:"50%",top:0,bottom:0,width:1})}{guide({top:"50%",left:0,right:0,height:1})}</>:null}
   </View></GestureDetector>
   {(["nw","ne","sw","se"] as const).map(corner=><CropHandle key={corner} corner={corner} rect={displayed}
     boundary={boundary} disabled={disabled} width={width} height={height} accentColor={accentColor} styled={styled} onBegin={begin}
     onDrag={(dx,dy)=>announce(resizeCropWithAspect(gestureStart.current,corner,dx/width,dy/height,aspectRatio))}
     onCommit={release}
     onCancel={cancel}/>)}
   {styled?<Text {...{className:accentColor?undefined:"text-text"}}
     style={{position:"absolute",bottom:4,left:4,fontSize:11,...(accentColor?{color:accentColor}:null)}}>
     {Math.round(displayed.width*100)}% × {Math.round(displayed.height*100)}%
   </Text>:null}
 </View>;
}
type HandleProps={
 boundary:string;disabled:boolean;corner:CropCorner;rect:CropRect;width:number;height:number;accentColor:string|undefined;styled:boolean;
 onBegin:()=>void;onDrag:(dx:number,dy:number)=>void;onCommit:()=>void;onCancel:()=>void;
};
function CropHandle({boundary,disabled,corner,rect,width,height,accentColor,styled,onBegin,onDrag,onCommit,onCancel}:HandleProps){
 const latest=useRef({onBegin,onDrag,onCommit,onCancel});
 useLayoutEffect(()=>{latest.current={onBegin,onDrag,onCommit,onCancel};});
 const pan=useEditorPan({disabled,boundary,onBegin:()=>latest.current.onBegin(),onMove:(dx,dy)=>latest.current.onDrag(dx,dy),onRelease:()=>latest.current.onCommit(),onCancel:()=>latest.current.onCancel()});
 const x=(corner.includes("w")?rect.x:rect.x+rect.width)*width;
 const y=(corner.includes("n")?rect.y:rect.y+rect.height)*height;
 // Hidden from screen readers: drag-only handles; the crop rectangle's
 // actions cover resize without a pointer.
 return <GestureDetector gesture={pan} touchAction="none" userSelect="none"><View
   importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
   style={{position:"absolute",left:x-22,top:y-22,width:44,height:44,justifyContent:"center",alignItems:"center"}}>
   <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-surface-raised",styled&&!accentColor&&"border-accent")}}
     style={{width:14,height:14,borderWidth:2,...(accentColor?{borderColor:accentColor}:null)}}/>
 </View></GestureDetector>;
}
