import {forgeRadius} from "../radius.ts";
import {cancelPreview} from "../cancel-preview.ts";
import {useRef} from "react";
import {PanResponder,Pressable,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {pointFromDrag,clamp,type Point2D} from "@nyc-tron/ui/components/shell/precision";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import { controlTokens, tokens } from "../tokens.ts";

type Local={width:number;height:number;active:boolean;preview:Point2D};
export interface InstrumentXYPadProps extends Omit<ViewProps,"children"> {
  x:number;
  y:number;
  label:string;
  disabled?:boolean;
  size?:number;
  step?:number;
  onPreview?:(point:Point2D)=>void;
  onCommit:(point:Point2D)=>void|Promise<unknown>;
  /** Optional override; defaults to the theme's accent token. */
  accentColor?:string;
  unstyled?:boolean;
  className?:string;
}
/** Multi-input pad with bounded normalized coordinates; no duplicate document state. */
export function InstrumentXYPad({
  x,y,label,disabled=false,size=180,step=0.05,onPreview,onCommit,accentColor,
  unstyled=false,className,onLayout,...rest
}:InstrumentXYPadProps){
  const latest=useRef({x,y,disabled,onPreview,onCommit});
  latest.current={x,y,disabled,onPreview,onCommit};
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({width:size,height:size,active:false,preview:{x,y}}));
  const store=local.current;
  const {width,height,active,preview}=useStore(store,s=>s);
  const position=active?preview:{x,y};
  const start=useRef<Point2D>({x,y});
  const cancel=()=>cancelPreview({x:latest.current.x,y:latest.current.y},preview=>store.setState({active:false,preview}),latest.current.onPreview);
  const commit=(next:Point2D)=>{
    const p=latest.current;
    if(p.disabled){cancel();return;}
    store.setState({preview:next,active:false});
    if(!p.disabled&&(next.x!==p.x||next.y!==p.y))void p.onCommit(next);
  };
  const responder=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!responder.current)responder.current=PanResponder.create({
    onStartShouldSetPanResponder:()=>!latest.current.disabled,
    onMoveShouldSetPanResponder:()=>!latest.current.disabled,
    onPanResponderGrant:()=>{
      start.current={x:latest.current.x,y:latest.current.y};
      store.setState({active:true,preview:start.current});
    },
    onPanResponderMove:(_e,gesture)=>{
      const p=latest.current;
      if(p.disabled)return;
      const {width:w,height:h}=store.getState();
      const next=pointFromDrag(start.current,gesture.dx,gesture.dy,w,h);
      store.setState({preview:next});
      p.onPreview?.(next);
    },
    onPanResponderRelease:()=>{if(store.getState().active)commit(store.getState().preview);},
    onPanResponderTerminate:cancel,
  });
  const nudge=(axis:"x"|"y",direction:-1|1)=>{
    if(disabled)return;
    const p={x,y};
    p[axis]=clamp(p[axis]+direction*step,0,1);
    commit(p);
  };
  const styled=!unstyled;
  const text=joinClasses(styled&&"text-text");
  const accentBorder=accentColor?{borderColor:accentColor}:null;
  const accentFill=accentColor?{backgroundColor:accentColor}:null;
  const accentBorderClass=styled&&!accentColor&&"border-accent";
  const accentFillClass=styled&&!accentColor&&"bg-accent";
  const arrow={minHeight:tokens.spacing.fixedTarget,minWidth:tokens.spacing.fixedTarget,justifyContent:"center" as const,alignItems:"center" as const,opacity:disabled?tokens.opacity.disabled:1};
  return <View {...rest} {...{className:joinClasses("items-center gap-2",!unstyled&&"bg-surface-raised rounded-control p-3",className)}}>
    <Text {...{className:joinClasses(!unstyled&&"text-text font-semibold")}}>{label}</Text>
    <View {...responder.current.panHandlers}
      onLayout={e=>{
        const l=e.nativeEvent.layout;
        if(l.width>0&&l.height>0)store.setState({width:l.width,height:l.height});
        onLayout?.(e);
      }}
      accessibilityRole="adjustable"
      accessible accessibilityLabel={label+" X and Y controller"}
      accessibilityValue={{text:"X "+Math.round(position.x*100)+"%, Y "+Math.round(position.y*100)+"%"}}
      accessibilityState={{disabled}}
      accessibilityHint="Swipe up or down to change X; use the actions menu to change Y"
      accessibilityActions={[
        {name:"increment",label:"Increase X"},{name:"decrement",label:"Decrease X"},
        {name:"increaseY",label:"Increase Y"},{name:"decreaseY",label:"Decrease Y"},
      ]}
      onAccessibilityAction={e=>{
        const a=e.nativeEvent.actionName;
        if(a==="increment")nudge("x",1);
        else if(a==="decrement")nudge("x",-1);
        else if(a==="increaseY")nudge("y",1);
        else if(a==="decreaseY")nudge("y",-1);
      }}
      {...{className:joinClasses(styled&&"bg-surface-sunken",accentBorderClass)}}
      style={{width:size,height:size,borderWidth:tokens.borderWidth.hairline,...accentBorder,opacity:disabled?tokens.opacity.disabled:1,overflow:"hidden"}}>
      <View pointerEvents="none" {...{className:joinClasses(accentFillClass)}}
        style={{position:"absolute",top:"50%",left:0,right:0,height:tokens.borderWidth.hairline,...accentFill,opacity:controlTokens.opacity.faint}}/>
      <View pointerEvents="none" {...{className:joinClasses(accentFillClass)}}
        style={{position:"absolute",left:"50%",top:0,bottom:0,width:tokens.borderWidth.hairline,...accentFill,opacity:controlTokens.opacity.faint}}/>
      <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-surface-raised",accentBorderClass)}}
        style={{position:"absolute",left:position.x*width-(tokens.spacing.off18 / 2),top:(tokens.borderWidth.hairline-position.y)*height-(tokens.spacing.off18 / 2),
        width:tokens.spacing.off18,height:tokens.spacing.off18,borderRadius:forgeRadius.sm,borderWidth:tokens.borderWidth.strong,...accentBorder}}/>
    </View>
    <View style={{flexDirection:"row",gap:tokens.spacing.fixedElement,alignItems:"center"}}>
      <Pressable accessibilityRole="button" accessibilityLabel={"Decrease "+label+" X"} disabled={disabled} onPress={()=>nudge("x",-1)}
        style={arrow}><Text {...{className:text}}>←</Text></Pressable>
      <Text {...{className:text}}>X {Math.round(position.x*100)}% · Y {Math.round(position.y*100)}%</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={"Increase "+label+" X"} disabled={disabled} onPress={()=>nudge("x",1)}
        style={arrow}><Text {...{className:text}}>→</Text></Pressable>
    </View>
    <View style={{flexDirection:"row",gap:tokens.spacing.fixedGroup}}>
      <Pressable accessibilityRole="button" accessibilityLabel={"Decrease "+label+" Y"} disabled={disabled} onPress={()=>nudge("y",-1)}
        style={arrow}><Text {...{className:text}}>↓</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={"Increase "+label+" Y"} disabled={disabled} onPress={()=>nudge("y",1)}
        style={arrow}><Text {...{className:text}}>↑</Text></Pressable>
    </View>
  </View>;
}
