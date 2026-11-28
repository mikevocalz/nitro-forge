import {memo} from "react";
import {View} from "react-native";
import {hsvToRgb,rgbaToHex} from "../color.ts";
import {hueSegments,saturationLayerAlphas} from "./segments.ts";

const WHITE=rgbaToHex(hsvToRgb({h:0,s:0,v:1,alpha:1}),false);
const BLACK=rgbaToHex({r:0,g:0,b:0,alpha:1},false);
const RING_SEGMENTS=hueSegments(120);
const DISC_SEGMENTS=hueSegments(96);
const SATURATION=saturationLayerAlphas(24);
const fill={position:"absolute" as const,left:0,top:0,right:0,bottom:0};

/**
 * One wedge per segment: a full-size view rotated about its center, holding a bar
 * from `from` to the edge. React Native transforms rotate clockwise, and hue
 * angles run anticlockwise, hence the negated angle.
 */
function Wedges({size,from,segments}:{size:number;from:number;segments:readonly {angle:number;color:string}[]}){
  const r=size/2;
  const chord=2*Math.PI*r/segments.length*1.15;
  return <>{segments.map(s=><View key={s.angle} pointerEvents="none" style={[fill,{transform:[{rotate:-s.angle+"deg"}]}]}>
    <View style={{position:"absolute",left:r+from,top:r-chord/2,width:r-from,height:chord,backgroundColor:s.color}}/>
  </View>)}</>;
}

/** The hue ring of `ColorWheel`, drawn once per size. `inner` is the hole radius. */
export const HueRingLayer=memo(function HueRingLayer({size,inner}:{size:number;inner:number}){
  return <View pointerEvents="none" style={{width:size,height:size,borderRadius:size/2,overflow:"hidden"}}>
    <Wedges size={size} from={inner*0.9} segments={RING_SEGMENTS}/>
  </View>;
});

/**
 * The hue/saturation disc of `ColorDiscPicker` at full value: pure-hue wedges,
 * then concentric white circles whose alphas make saturation linear in radius,
 * then black at `1 - value`. Only the black layer depends on the color.
 */
export const HueSaturationDiscLayer=memo(function HueSaturationDiscLayer({size,value}:{size:number;value:number}){
  return <View pointerEvents="none" style={{width:size,height:size,borderRadius:size/2,overflow:"hidden"}}>
    <Wedges size={size} from={0} segments={DISC_SEGMENTS}/>
    {SATURATION.map((alpha,i)=>{
      const d=size*(SATURATION.length-i)/SATURATION.length;
      return <View key={i} style={{position:"absolute",left:(size-d)/2,top:(size-d)/2,width:d,height:d,borderRadius:d/2,backgroundColor:WHITE,opacity:alpha}}/>;
    })}
    <View style={[fill,{backgroundColor:BLACK,opacity:1-value}]}/>
  </View>;
});
