import { useRef } from "react";
import { View, type ViewProps } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { Select } from "@nyc-tron/ui/components/Select";
import { Button } from "@nyc-tron/ui/components/Button";
import { UnitInput } from "@nyc-tron/ui/components/shell/UnitInput";
import { ColorChannelFields } from "./ColorChannelFields.tsx";
import type { ChannelModel } from "./channel-fields.ts";
import { rgbToHsv,hsvToRgb } from "../color.ts";
import {validateGradientOptions,sampleGradient,changeGradientType,rotateGradient,type GradientOptions} from "./gradient-options.ts";
import { addStop,moveStop,removeStop,validateGradient,addStopAvailability,removeStopAvailability } from "../vector/gradient-handles-model.ts";
import type { GradientPaint } from "../vector/vector-types.ts";
import { tokens } from "../tokens.ts";
/** Gradient stop selection and paint commit are owned by the consuming document. */
export interface GradientStopEditorProps extends Omit<ViewProps,"children"> {
 readonly value:GradientPaint;
 readonly selectedIndex:number;
 readonly options:GradientOptions;
 readonly onSelect:(index:number)=>void;
 /** One paint transaction; returned selection avoids a stale index after insertion/deletion. */
 readonly onCommit:(paint:GradientPaint,selectedIndex:number,options:GradientOptions)=>void;
 readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Edits stop positions and RGBA, inserts interpolated stops and prevents fewer than two stops. */
export function GradientStopEditor({value,selectedIndex,options,onSelect,onCommit,disabled=false,unstyled=false,...props}:GradientStopEditorProps){
 validateGradientOptions(value,options);
 if(!Number.isInteger(selectedIndex)||!value.stops[selectedIndex])throw new RangeError("Select an existing gradient stop");
 const local=useRef<StoreApi<{model:ChannelModel}>|null>(null);local.current??=createStore(()=>({model:'rgb' as ChannelModel}));
 const store=local.current,model=useStore(store,s=>s.model),stop=value.stops[selectedIndex]!;
 const add=addStopAvailability(value),remove=removeStopAvailability(value,selectedIndex);
 const color={r:stop.color[0],g:stop.color[1],b:stop.color[2],alpha:stop.color[3]/255};
 const commit=(paint:GradientPaint,index=selectedIndex,nextOptions=options)=>{validateGradientOptions(paint,nextOptions);onCommit(paint,index,nextOptions);};
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Select label="Gradient type" value={value.type} options={[{value:'linear',label:'Linear'},{value:'radial',label:'Radial'}]} disabled={disabled} unstyled={unstyled} onValueChange={type=>{if(!disabled)commit(changeGradientType(value,type as GradientPaint['type']));}}/>
  {value.type==='linear'?<UnitInput label="Gradient angle degrees" value={Math.atan2(value.y1-value.y0,value.x1-value.x0)*180/Math.PI} min={-180} max={180} step={1} precision={3} disabled={disabled} unstyled={unstyled} onCommit={degrees=>{if(!disabled)commit(rotateGradient(value,degrees));}}/>:null}
  <Select label="Gradient interpolation" value={options.interpolation} options={[{value:'srgb',label:'sRGB'},{value:'linear-rgb',label:'Linear-light RGB'}]} disabled={disabled} unstyled={unstyled} onValueChange={interpolation=>{if(!disabled)commit(value,selectedIndex,{...options,interpolation:interpolation as GradientOptions['interpolation']});}}/>
  {selectedIndex<value.stops.length-1?<UnitInput label="Gradient midpoint percent" value={options.midpoints[selectedIndex]!*100} min={.1} max={99.9} step={.1} precision={3} disabled={disabled} unstyled={unstyled} onCommit={midpoint=>{if(!disabled)commit(value,selectedIndex,{...options,midpoints:options.midpoints.map((v,i)=>i===selectedIndex?midpoint/100:v)});}}/>:null}
  <Select label="Gradient stop" value={String(selectedIndex)} options={value.stops.map((stop,index)=>({value:String(index),label:`Stop ${index+1} at ${Math.round(stop.offset*1000)/10} percent`}))} disabled={disabled} unstyled={unstyled} onValueChange={index=>{if(!disabled)onSelect(Number(index));}}/>
  <UnitInput label="Stop position percent" value={stop.offset*100} min={(value.stops[selectedIndex-1]?.offset??0)*100} max={(value.stops[selectedIndex+1]?.offset??1)*100} step={.1} precision={2} disabled={disabled} unstyled={unstyled} onCommit={offset=>{if(!disabled)commit(moveStop(value,selectedIndex,offset/100),selectedIndex);}}/>
  <ColorChannelFields value={rgbToHsv(color)} model={model} onModelChange={model=>store.setState({model})} disabled={disabled} unstyled={unstyled} onCommit={next=>{
    if(disabled)return;const c=hsvToRgb(next);commit({...value,stops:value.stops.map((item,index)=>index===selectedIndex?{...item,color:[c.r,c.g,c.b,Math.round(c.alpha*255)]}:item)},selectedIndex);
  }}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}>
   <Button title="Add gradient stop" disabled={disabled||!add.enabled} unstyled={unstyled} onPress={()=>{if(disabled||!add.enabled)return;const next=addStop(value,(stop.offset+(value.stops[selectedIndex+1]?.offset??1))/2);const offset=next.paint.stops[next.index]!.offset,color=sampleGradient(value,options,offset);
    const paint={...next.paint,stops:next.paint.stops.map((s,i)=>i===next.index?{...s,color}:s)};
    const interval=Math.min(options.midpoints.length-1,Math.max(0,next.index-1));
    commit(paint,next.index,{...options,midpoints:[...options.midpoints.slice(0,interval),.5,.5,...options.midpoints.slice(interval+1)]});}}/>
   <Button title="Remove gradient stop" disabled={disabled||!remove.enabled} unstyled={unstyled} onPress={()=>{if(!disabled&&remove.enabled)commit(removeStop(value,selectedIndex),Math.min(selectedIndex,value.stops.length-2),{...options,midpoints:selectedIndex===0?options.midpoints.slice(1):selectedIndex===value.stops.length-1?options.midpoints.slice(0,-1):[...options.midpoints.slice(0,selectedIndex-1),.5,...options.midpoints.slice(selectedIndex+1)]});}}/>
  </View>
 </View>;
}
