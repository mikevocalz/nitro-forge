import {useEffect,useMemo,useRef} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {adjustKey} from "@nyc-tron/ui/components/gestures/adjust-keys";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";
import {assertHsv,hsvToRgb,rgbaToHex,wrapHue,type HsvColor} from "../color.ts";
import {createRingDrag,hueToRingPoint,RING_INNER_FRACTION} from "./wheel-geometry.ts";
import {HueRingLayer} from "./wheel-layers.tsx";
import { tokens } from "../tokens.ts";

/** Props for {@linkcode ColorWheel}. */
export interface ColorWheelProps extends Omit<ViewProps,"children"> {
  /** The committed color. The wheel changes only its hue. */
  readonly value:HsvColor;
  /** Every drag move. */
  readonly onPreview?:(next:HsvColor)=>void;
  /** Once per drag release, key press or screen-reader action that changes the hue. */
  readonly onCommit:(next:HsvColor)=>void;
  /** Largest diameter in layout units; the wheel shrinks to fit its container. @default 240 */
  readonly maxSize?:number;
  /** Degrees per arrow key or screen-reader step. Page Up/Down take 15. @default 1 */
  readonly step?:number;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const THUMB=30;

/**
 * Controlled hue ring (C-03). Touching the ring jumps to that hue; sliding the
 * finger into the hole switches to fine adjustment (a fifth of the rotation),
 * shown under the wheel, and sliding back out resumes 1:1 tracking. Saturation,
 * value and alpha are never touched, so a gray keeps the hue it had. The center
 * shows the full current color.
 */
export function ColorWheel({
  value,onPreview,onCommit,maxSize=240,step=1,disabled=false,className,unstyled=false,testID,style,...rest
}:ColorWheelProps){
  assertHsv(value);
  if(!Number.isFinite(maxSize)||maxSize<120||maxSize>800)throw new RangeError("maxSize must be 120..800");
  if(!Number.isFinite(step)||step<=0||step>360)throw new RangeError("Hue step must be greater than 0 and at most 360 degrees");
  const [state,store]=useLocalStore(()=>({width:0,preview:undefined as number|undefined,fine:false}));
  const latest=useRef({value,onPreview,onCommit,disabled});
  latest.current={value,onPreview,onCommit,disabled};
  const ring=useMemo(createRingDrag,[]);
  const gesture=useMemo(()=>createValueGesture<number>({
    disabled:()=>latest.current.disabled,
    equals:(a,b)=>a===b,
    preview:h=>{store.set(s=>({...s,preview:h}));latest.current.onPreview?.({...latest.current.value,h});},
    commit:h=>latest.current.onCommit({...latest.current.value,h}),
  }),[store]);
  useEffect(()=>()=>gesture.cancel(),[gesture]);
  const size=Math.max(120,Math.min(maxSize,state.width||maxSize));
  const box={width:size,height:size};
  const end=()=>store.set(s=>({...s,preview:undefined,fine:false}));
  const handlers=useLocalPointer({
    disabled,
    onBegin:p=>{
      gesture.begin(wrapHue(latest.current.value.h));
      const r=ring.begin(p,box,latest.current.value.h);
      store.set(s=>({...s,fine:r.fine}));
      gesture.update(r.hue);
    },
    onMove:p=>{const r=ring.move(p,box);if(r.fine!==state.fine)store.set(s=>({...s,fine:r.fine}));gesture.update(r.hue);},
    onRelease:()=>{gesture.release();end();},
    onCancel:()=>{gesture.cancel();end();},
  });
  const commitHue=(h:number)=>{
    const next=wrapHue(Math.round(h*100)/100);
    if(!disabled&&next!==wrapHue(value.h))onCommit({...value,h:next});
  };
  const onKeyDown=(event:KeyEventLike)=>{
    const intent=adjustKey(keyboardKey(event));
    if(!intent)return;
    if(intent.kind==="cancel"){if(gesture.active){gesture.cancel();end();}return;}
    if(intent.kind==="step")commitHue(value.h+intent.direction*step);
    else if(intent.kind==="page")commitHue(value.h+intent.direction*15);
    else commitHue(intent.kind==="min"?0:359);
    (event as {preventDefault?:()=>void}).preventDefault?.();
  };
  const hue=wrapHue(state.preview??value.h);
  const shownHue=Math.round(hue)%360;
  const thumb=hueToRingPoint(hue,box);
  const inner=size/2*RING_INNER_FRACTION;
  const center=inner*1.5;
  const styled=!unstyled;
  return <View {...rest} testID={testID} {...{className:joinClasses("items-center gap-2",className)}} style={style}
    onLayout={e=>store.set(s=>({...s,width:e.nativeEvent.layout.width}))}>
    <View {...handlers}
      {...{onKeyDown,focusable:!disabled,className:joinClasses(styled&&"focus-visible:ring-2 focus-visible:ring-focus")}}
      accessible accessibilityRole="adjustable" accessibilityLabel="Hue"
      accessibilityHint="Drag around the ring. Slide inward for fine adjustment. Arrow keys change the hue by one degree."
      aria-valuemin={0} aria-valuemax={359} aria-valuenow={shownHue} aria-valuetext={shownHue+" degrees"}
      aria-disabled={disabled}
      accessibilityActions={[{name:"increment",label:"Increase hue"},{name:"decrement",label:"Decrease hue"}]}
      onAccessibilityAction={e=>{
        if(e.nativeEvent.actionName==="increment")commitHue(value.h+step);
        if(e.nativeEvent.actionName==="decrement")commitHue(value.h-step);
      }}
      style={{width:size,height:size,borderRadius:size/2, /* radius-exempt: colour-well */opacity:disabled?tokens.opacity.disabled:1,...NO_SELECT}}>
      <HueRingLayer size={size} inner={inner}/>
      <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-surface-raised")}}
        style={{position:"absolute",left:size/2-inner,top:size/2-inner,width:inner*tokens.spacing.off2,height:inner*tokens.spacing.off2,borderRadius:inner /* radius-exempt: colour-well */}}/>
      <View pointerEvents="none" {...{className:joinClasses(styled&&"border-border")}}
        style={{position:"absolute",left:size/2-center/2,top:size/2-center/2,width:center,height:center,borderRadius:center/2, /* radius-exempt: colour-well */
          borderWidth:tokens.borderWidth.hairline,backgroundColor:rgbaToHex(hsvToRgb({...value,h:hue,alpha:1}),false)}}/>
      <View pointerEvents="none" {...{className:joinClasses(styled&&"border-text")}}
        style={{position:"absolute",left:thumb.x-THUMB/2,top:thumb.y-THUMB/2,width:THUMB,height:THUMB,borderRadius:THUMB/2, /* radius-exempt: colour-well */
          borderWidth:tokens.borderWidth.strong,alignItems:"center",justifyContent:"center"}}>
        <View {...{className:joinClasses(styled&&"border-surface-raised")}}
          style={{width:THUMB-tokens.spacing.fixedStack,height:THUMB-tokens.spacing.fixedStack,borderRadius:(THUMB-(tokens.spacing.fixedElement / 2))/2, /* radius-exempt: colour-well */borderWidth:tokens.borderWidth.strong,
            backgroundColor:rgbaToHex(hsvToRgb({h:hue,s:1,v:1,alpha:1}),false)}}/>
      </View>
    </View>
    <Text {...{className:joinClasses(styled&&(state.fine?"text-text":"text-text-muted"),styled&&"text-sm")}}
      style={{fontVariant:["tabular-nums"]}}>
      {state.fine?`Hue ${shownHue}° (fine)`:`Hue ${shownHue}°`}
    </Text>
  </View>;
}
