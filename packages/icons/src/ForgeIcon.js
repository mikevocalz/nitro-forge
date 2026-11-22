import React,{useEffect,useId,useRef} from "react";
import {Animated,Easing,Pressable,View} from "react-native";
import Svg,{G,Mask,Path,Rect} from "react-native-svg";
import {getGlyph} from "./glyphs.js";
import {resolveIconState} from "./state.js";
import {iconStroke,iconMotion} from "./tokens.js";

function pathProps(d,solid,paint,key){
 return {key,d,stroke:solid?"none":paint,fill:solid?paint:"none",
   strokeWidth:iconStroke.width,strokeLinecap:"round",
   strokeLinejoin:"round",fillRule:"evenodd"};
}
/**
 * Knockout paths are cut out of the glyph with an SVG mask, so the detail
 * shows whatever surface the icon sits on (toolbar pill, selected chip,
 * canvas) instead of a guessed background color.
 */
function IconPaths({name,variant,color,size}){
 const maskId="forge-icon-mask-"+useId().replace(/[^A-Za-z0-9_-]/g,"");
 const paths=getGlyph(name,variant);
 if(!paths)return null;
 const ink=[],cuts=[];
 paths.forEach(([d,mode],index)=>{
   if(mode==="knockout")cuts.push(pathProps(d,/[zZ]\s*$/.test(d),"#000",index));
   else ink.push(pathProps(d,mode==="fill",color,index));
 });
 const inkPaths=ink.map(props=>React.createElement(Path,props));
 return React.createElement(Svg,{width:size,height:size,viewBox:"0 0 24 24",accessible:false,focusable:false},
   cuts.length===0?inkPaths:[
     React.createElement(Mask,{key:"mask",id:maskId,maskUnits:"userSpaceOnUse",x:0,y:0,width:24,height:24},
       React.createElement(Rect,{x:0,y:0,width:24,height:24,fill:"#fff"}),
       cuts.map(props=>React.createElement(Path,props))),
     React.createElement(G,{key:"ink",mask:"url(#"+maskId+")"},inkPaths)
   ]);
}
/**
 * Shared native/web icon. Selected=filled, idle=outline.
 * Can render a real host-supplied Rive artboard, otherwise an Animated
 * outline-to-filled crossfade. Never invents operation success.
 */
export function ForgeIcon({
 name,selected=false,disabled=false,loading=false,pressed=false,hovered=false,
 status="idle",size="default",appearance="light",color,selectedColor,disabledColor,
 successColor,errorColor,reducedMotion=false,renderRive,testID
}){
 const input={selected,disabled,loading,pressed,hovered,status,
   size,appearance,color,selectedColor,disabledColor,successColor,
   errorColor,reducedMotion};
 const view=resolveIconState(input);
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
         size:view.size})),
     React.createElement(Animated.View,{style:{...box,opacity:progress}},
       React.createElement(IconPaths,{name,variant:"filled",color:view.color,
         size:view.size}))));
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
