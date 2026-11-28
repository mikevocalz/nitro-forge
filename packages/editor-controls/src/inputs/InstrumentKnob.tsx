import {forgeHairlineRadius} from "../radius.ts";
import {cancelPreview} from "../cancel-preview.ts";
import {useRef} from "react";
import {PanResponder,Pressable,Text,TextInput,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {clamp,scrubValue,snapValue,gestureToAngle,type RangeConfig} from "@nyc-tron/ui/components/shell/precision";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {exact} from "../exact-optional.ts";
import { tokens } from "../tokens.ts";

type Local={preview:number;draft:string;editing:boolean;active:boolean};
export interface InstrumentKnobProps extends Omit<ViewProps,"children">,RangeConfig {
  value:number;
  label:string;
  unit?:string;
  size?:number;
  disabled?:boolean;
  onPreview?:(value:number)=>void;
  /** Exactly once per completed gesture, never on every frame. */
  onCommit:(value:number)=>void|Promise<unknown>;
  className?:string;
  unstyled?:boolean;
  /** Optional override; defaults to the theme's accent token. */
  accentColor?:string;
}
/** Native responder-based parametric control. App owns Tailwind theme; engine owns the committed value. */
export function InstrumentKnob({
  min,max,step,detents,value,label,unit,size=112,disabled=false,onPreview,onCommit,
  className,unstyled=false,accentColor,...rest
}:InstrumentKnobProps){
  const latest=useRef({min,max,step,detents,value,disabled,onPreview,onCommit});
  latest.current={min,max,step,detents,value,disabled,onPreview,onCommit};
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({preview:value,draft:String(value),editing:false,active:false}));
  const store=local.current;
  const active=useStore(store,s=>s.active);
  const editing=useStore(store,s=>s.editing);
  const draft=useStore(store,s=>s.draft);
  const preview=useStore(store,s=>s.preview);
  const current=active||editing?preview:value;
  const start=useRef(value);
  const cancel=()=>cancelPreview(latest.current.value,value=>store.setState({active:false,editing:false,preview:value,draft:String(value)}),latest.current.onPreview);
  const commit=(next:number)=>{
    const p=latest.current;
    if(p.disabled){cancel();return;}
    const rounded=snapValue(next,exact(p));
    store.setState({active:false,editing:false,preview:rounded,draft:String(rounded)});
    if(rounded!==p.value)void p.onCommit(rounded);
  };
  const responder=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!responder.current)responder.current=PanResponder.create({
    onStartShouldSetPanResponder:()=>!latest.current.disabled,
    onMoveShouldSetPanResponder:()=>!latest.current.disabled,
    onPanResponderGrant:()=>{
      start.current=latest.current.value;
      store.setState({active:true,preview:start.current,draft:String(start.current)});
    },
    onPanResponderMove:(_event,gesture)=>{
      const p=latest.current;
      if(p.disabled)return;
      const next=scrubValue(start.current,gesture.dx,gesture.dy,exact(p));
      if(next!==store.getState().preview){
        store.setState({preview:next,draft:String(next)});
        p.onPreview?.(next);
      }
    },
    onPanResponderRelease:()=>{if(store.getState().active)commit(store.getState().preview);},
    onPanResponderTerminate:cancel,
    onPanResponderTerminationRequest:()=>true,
  });
  const enter=()=>{
    if(!store.getState().editing)return;
    const next=Number(store.getState().draft.trim());
    if(Number.isFinite(next))commit(next);
    else store.setState({editing:false,preview:latest.current.value,draft:String(latest.current.value)});
  };
  const nudge=(direction:-1|1)=>{
    if(!disabled)commit(clamp(value+direction*step,min,max));
  };
  const styled=!unstyled;
  const accentBorder=accentColor?{borderColor:accentColor}:null;
  const accentFill=accentColor?{backgroundColor:accentColor}:null;
  const text=joinClasses(styled&&"text-text");
  return <View {...rest} {...{className:joinClasses("items-center gap-2",!unstyled&&"rounded-control bg-surface-raised p-3",className)}}
    accessibilityLabel={label}>
    <Text {...{className:joinClasses(!unstyled&&"text-text font-semibold")}}>{label}</Text>
    <View {...responder.current.panHandlers}
      accessible accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{min,max,now:current,text:String(current)+(unit?" "+unit:"")}}
      accessibilityState={{disabled}}
      {...{className:joinClasses(styled&&!accentColor&&"border-accent")}}
      accessibilityActions={[{name:"increment"},{name:"decrement"}]}
      onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="increment")nudge(1);if(e.nativeEvent.actionName==="decrement")nudge(-1);}}
      style={{width:size,height:size,borderRadius:size/2, /* radius-exempt: knob */borderWidth:tokens.spacing.fixedElement,...accentBorder,alignItems:"center",justifyContent:"center",opacity:disabled?tokens.opacity.disabled:1}}>
      <View pointerEvents="none" {...{className:joinClasses(styled&&!accentColor&&"bg-accent")}}
        style={{position:"absolute",width:tokens.spacing.off3,height:size*0.28,...accentFill,
        borderRadius:forgeHairlineRadius.tick,transform:[{translateY:-size*0.2},{rotate:gestureToAngle(current,min,max)+"deg"}]}} />
      <Text {...{className:joinClasses(!unstyled&&"text-text font-semibold")}}>{String(current)}</Text>
    </View>
    <View style={{flexDirection:"row",alignItems:"center",gap:tokens.spacing.off6}}>
      <Pressable accessibilityRole="button" accessibilityLabel={"Decrease "+label} disabled={disabled}
        onPress={()=>nudge(-1)} style={{minWidth:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedTarget,justifyContent:"center",alignItems:"center",opacity:disabled?tokens.opacity.disabled:1}}><Text {...{className:text}}>−</Text></Pressable>
      <TextInput accessibilityLabel={label+" numeric value"} keyboardType="decimal-pad" editable={!disabled}
        {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken text-text")}}
        style={{minWidth:tokens.spacing.fixedPage,minHeight:tokens.spacing.fixedTarget,textAlign:"center"}}
        value={editing?draft:String(current)}
        onFocus={()=>store.setState({editing:true,draft:String(value),preview:value})}
        onChangeText={v=>store.setState({draft:v})}
        onSubmitEditing={enter}
        onBlur={enter}/>
      <Pressable accessibilityRole="button" accessibilityLabel={"Increase "+label} disabled={disabled}
        onPress={()=>nudge(1)} style={{minWidth:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedTarget,justifyContent:"center",alignItems:"center",opacity:disabled?tokens.opacity.disabled:1}}><Text {...{className:text}}>+</Text></Pressable>
    </View>
    {unit?<Text {...{className:joinClasses(styled&&"text-text-muted")}}>{unit}</Text>:null}
  </View>;
}
