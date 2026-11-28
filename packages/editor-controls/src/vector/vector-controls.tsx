/**
 * Small pieces shared by the vector-tools components: a straight overlay line
 * drawn as a rotated view (the PatchGraph wire technique, since the package has
 * no SVG dependency), and a command button that stays pressable while
 * unavailable so it can say why in the cluster's notice line.
 */
import {useRef,type ReactNode} from "react";
import {PanResponder,Pressable,Text,View,type GestureResponderEvent} from "react-native";
import {createCanvasResponder} from "@nyc-tron/ui/components/gestures/canvas-responder";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import type {Point} from "./vector-types.ts";
import { tokens } from "../tokens.ts";

/** Every vector-tools control target is at least this many points square. */
export const VECTOR_TOUCH_TARGET=44;

/** A straight line between two view points, never a touch target. */
export function LinePiece({from,to,thickness=2,className,color,opacity=1}:{
  from:Point;to:Point;thickness?:number;className?:string|undefined;color?:string|undefined;opacity?:number;
}){
  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);
  if(len<0.01)return null;
  return <View pointerEvents="none" {...{className}}
    style={{position:"absolute",left:(from.x+to.x-len)/2,top:(from.y+to.y)/2-thickness/2,width:len,height:thickness,
      opacity,...(color?{backgroundColor:color}:null),transform:[{rotate:Math.atan2(dy,dx)*180/Math.PI+"deg"}]}}/>;
}

/**
 * Command button for the vector tools. When `reason` is set the button reads
 * as unavailable but still takes the press and reports the reason instead of
 * running, so nothing is silently dead.
 */
export function VectorButton({label,reason,onPress,onBlocked,role="button",checked,styled,children,testID}:{
  label:string;reason?:string|undefined;onPress:()=>void;onBlocked:(reason:string)=>void;
  role?:"button"|"radio"|"switch";checked?:boolean;styled:boolean;children?:ReactNode;testID?:string;
}){
  const disabled=reason!==undefined;
  const on=checked===true;
  // React Native Web's Pressable overwrites aria-disabled with its own
  // `disabled` prop, which would swallow the press; "unavailable" in the name
  // carries the state on web and accessibilityState carries it natively.
  return <Pressable role={role} aria-label={disabled?label+", unavailable":label} testID={testID}
    aria-checked={role==="button"?undefined:on} accessibilityState={{disabled,...(role==="button"?{}:{checked:on})}}
    accessibilityHint={reason}
    onPress={()=>{if(reason!==undefined)onBlocked(reason);else onPress();}}
    {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
      styled&&(on?"border-primary bg-primary":"border-border bg-surface-raised"))}}
    style={{minWidth:VECTOR_TOUCH_TARGET,minHeight:VECTOR_TOUCH_TARGET,paddingHorizontal:tokens.spacing.fixedInset,
      flexDirection:"row",alignItems:"center",justifyContent:"center",gap:tokens.spacing.off6,opacity:disabled?tokens.opacity.disabled:1}}>
    {children}
    <Text numberOfLines={1} {...{className:joinClasses(styled&&(on?"text-on-primary":"text-text"))}}
      style={{fontSize:tokens.text.off13,fontWeight:on?"700":"500"}}>{label}</Text>
  </Pressable>;
}

/** Polite status line: hints, and the reason an unavailable command did not run. */
export function NoticeLine({text,styled,testID}:{text:string|undefined;styled:boolean;testID?:string}){
  return <Text accessibilityLiveRegion="polite" aria-live="polite" testID={testID}
    {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{minHeight:tokens.spacing.off18}}>{text??""}</Text>;
}

/** Group heading inside an inspector or bar. */
export function GroupLabel({children,styled,nativeID}:{children:string;styled:boolean;nativeID?:string}){
  return <Text accessibilityRole="header" nativeID={nativeID}
    {...{className:joinClasses(styled&&"text-text text-xs font-semibold")}}>{children}</Text>;
}

/** Modifier keys seen during a canvas drag. React Native Web reports Shift; Alt comes from key tracking. */
export interface DragModifiers {
  readonly alt:boolean;
  readonly shift:boolean;
  readonly ctrl?:boolean;
  readonly meta?:boolean;
}
/** Keyboard event shape on web (`key`, modifiers) and native (`nativeEvent`). */
export type CanvasKeyEvent={
  key?:string;shiftKey?:boolean;altKey?:boolean;preventDefault?:()=>void;
  nativeEvent?:{key?:string;shiftKey?:boolean;altKey?:boolean};
};
/** Props for {@linkcode CanvasKnob}. */
export interface CanvasKnobProps {
  /** Centre in overlay points. */
  at:Point;
  testID:string;
  label:string;
  hint:string;
  selected:boolean;
  actions:readonly {name:string;label:string}[];
  onAction:(name:string)=>void;
  onKeyDown:(event:CanvasKeyEvent)=>void;
  onFocus?:()=>void;
  onBegin:(modifiers:DragModifiers)=>void;
  /** View-space travel since the press. Preview only. */
  onMove:(dx:number,dy:number,modifiers:DragModifiers)=>void;
  onRelease:()=>void;
  onCancel:()=>void;
  /** Drawn marker, centred in the 44pt target. */
  children:ReactNode;
  zIndex?:number;
  styled:boolean;
}
/**
 * A 44pt draggable, focusable target centred on an on-canvas point. A second
 * pointer or OS termination cancels; a parent scroll view cannot steal it.
 */
export function CanvasKnob(props:CanvasKnobProps){
  const {at,testID,label,hint,selected,actions,onAction,onKeyDown,onFocus,children,zIndex=1,styled}=props;
  const latest=useRef(props);
  latest.current=props;
  const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!pan.current)pan.current=createCanvasResponder({
    onStartShouldSetPanResponder:e=>(e.nativeEvent.touches?.length??1)<=1,
    onMoveShouldSetPanResponder:()=>true,
    onPanResponderGrant:e=>{const n=e.nativeEvent as {altKey?:boolean;shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean};latest.current.onBegin({alt:n.altKey===true,shift:n.shiftKey===true,ctrl:n.ctrlKey===true,meta:n.metaKey===true});},
    onPanResponderMove:(e:GestureResponderEvent,g)=>{
      if(g.numberActiveTouches>1){latest.current.onCancel();return;}
      const n=e.nativeEvent as {altKey?:boolean;shiftKey?:boolean};
      latest.current.onMove(g.dx,g.dy,{alt:n.altKey===true,shift:n.shiftKey===true});
    },
    onPanResponderRelease:()=>latest.current.onRelease(),
    onPanResponderTerminationRequest:()=>false,
    onPanResponderTerminate:()=>latest.current.onCancel(),
  });
  return <View {...pan.current.panHandlers} accessible testID={testID}
    accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{selected}} accessibilityActions={actions}
    onAccessibilityAction={e=>onAction(e.nativeEvent.actionName)}
    {...{onKeyDown,focusable:true,onFocus,
      className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    style={{position:"absolute",left:at.x-VECTOR_TOUCH_TARGET/2,top:at.y-VECTOR_TOUCH_TARGET/2,
      width:VECTOR_TOUCH_TARGET,height:VECTOR_TOUCH_TARGET,alignItems:"center",justifyContent:"center",zIndex}}>
    {children}
  </View>;
}
