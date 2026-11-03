import React,{useEffect,useRef} from "react";
import {Animated,Easing,Pressable,View} from "react-native";
import Svg,{Path} from "react-native-svg";
import {getGlyph} from "./glyphs.js";
import {resolveIconState} from "./state.js";
import {iconStroke,iconMotion} from "./tokens.js";

function IconPaths({name,variant,color,surfaceColor,size}){
 const paths=getGlyph(name,variant);
 if(!paths)return null;
 return React.createElement(Svg,{width:size,height:size,viewBox:"0 0 24 24",accessible:false,focusable:false},
   paths.map(([d,mode],index)=>{
     const knockout=mode==="knockout";
     const solid=mode==="fill"||(knockout&&/[zZ]\s*$/.test(d));
     const ink=knockout?surfaceColor:color;
     return React.createElement(Path,{key:index,d,
       stroke:solid?"none":ink,fill:solid?ink:"none",
       strokeWidth:iconStroke.width,strokeLinecap:"round",
       strokeLinejoin:"round",fillRule:"evenodd"});
   }));
}
/**
 * Shared native/web icon. Selected=filled, idle=outline.
 * Can render a real host-supplied Rive artboard, otherwise an Animated
 * outline-to-filled crossfade. Never invents operation success.
 */
export function ForgeIcon({
 name,selected=false,disabled=false,loading=false,pressed=false,hovered=false,
 status="idle",size="default",appearance="light",color,selectedColor,disabledColor,
 successColor,errorColor,surfaceColor,reducedMotion=false,renderRive,testID
}){
 const input={selected,disabled,loading,pressed,hovered,status,
   size,appearance,color,selectedColor,disabledColor,successColor,
   errorColor,reducedMotion};
 const view=resolveIconState(input);
 const surface=surfaceColor??(appearance==="dark"?"#11131B":"#FFFFFF");
 const progress=useRef(new Animated.Value(selected?1:0)).current;
 const scale=useRef(new Animated.Value(1)).current;
 const rotation=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
   progress.stopAnimation();
   if(disabled||reducedMotion){progress.setValue(selected?1:0);return;}
   const motion=Animated.timing(progress,{toValue:selected?1:0,
     duration:selected?iconMotion.selectMs:iconMotion.deselectMs,
     easing:Easing.out(Easing.cubic),useNativeDriver:true});
   motion.start();return()=>motion.stop();
 },[progress,selected,reducedMotion,disabled]);
 useEffect(()=>{
   scale.stopAnimation();
   if(disabled||reducedMotion){scale.setValue(1);return;}
   const motion=Animated.spring(scale,{toValue:pressed?iconMotion.pressScale:
     selected?iconMotion.selectedScale:1,stiffness:260,damping:22,
     mass:0.8,useNativeDriver:true});
   motion.start();return()=>motion.stop();
 },[scale,pressed,selected,reducedMotion,disabled]);
 useEffect(()=>{
   rotation.stopAnimation();rotation.setValue(0);
   if(!loading||disabled||reducedMotion)return;
   const motion=Animated.loop(Animated.timing(rotation,{toValue:1,
     duration:iconMotion.loadingMs,easing:Easing.linear,useNativeDriver:true}));
   motion.start();return()=>{motion.stop();rotation.setValue(0);};
 },[rotation,loading,reducedMotion,disabled]);
 if(!getGlyph(name,"outline"))return null;
 const rive=typeof renderRive==="function"?renderRive({
   name,selected,disabled,loading,pressed,hovered,status,
   color:view.color,size:view.size,reducedMotion,artboard:"ForgeIcon",
   stateMachine:"ForgeIconStates"
 }):null;
 if(rive!==null&&rive!==undefined)return rive;
 const invisible=progress.interpolate({inputRange:[0,1],outputRange:[1,0]});
 const spin=rotation.interpolate({inputRange:[0,1],outputRange:["0deg","360deg"]});
 const box={position:"absolute",left:0,top:0,width:view.size,height:view.size};
 return React.createElement(Animated.View,{testID,accessible:false,
   style:{width:view.size,height:view.size,opacity:view.opacity,
     transform:[{scale},{rotate:spin}]}},
   React.createElement(View,{style:{width:view.size,height:view.size}},
     React.createElement(Animated.View,{style:{...box,opacity:invisible}},
       React.createElement(IconPaths,{name,variant:"outline",color:view.color,
         surfaceColor:surface,size:view.size})),
     React.createElement(Animated.View,{style:{...box,opacity:progress}},
       React.createElement(IconPaths,{name,variant:"filled",color:view.color,
         surfaceColor:surface,size:view.size}))));
}
/** Accessible min-44pt hit target. Host owns selection via Zustand/other store. */
export function ForgeIconButton({name,label,onPress,selected=false,disabled=false,
 loading=false,size="default",testID,...rest}){
 if(typeof label!=="string"||!label.trim())
   throw new TypeError("ForgeIconButton requires an accessible label");
 return React.createElement(Pressable,{
   testID,disabled:disabled||loading,onPress,
   accessibilityRole:"button",accessibilityLabel:label,
   accessibilityState:{selected,disabled,busy:loading},hitSlop:4,
   style:{minWidth:44,minHeight:44,justifyContent:"center",alignItems:"center"}
 },({pressed})=>React.createElement(ForgeIcon,{
   ...rest,name,selected,disabled,loading,size,pressed
 }));
}
