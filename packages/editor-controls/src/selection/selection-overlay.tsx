import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {MAX_DRAWN_SEGMENTS,pathSegments,thinPoints,type DocPoint,type DocRect} from "./selection-model.ts";

// Shared drawing pieces for the selection surfaces. Everything here is
// pointer-transparent and hidden from screen readers; the surfaces speak
// the shapes through their own labels.
const HIDDEN={pointerEvents:"none",importantForAccessibility:"no-hide-descendants",accessibilityElementsHidden:true} as const;

/**
 * Committed selection bounds drawn as a two-tone dashed outline: a solid
 * surface-coloured line under a dashed text-coloured one, readable on light
 * and dark artwork alike. Static on purpose, so reduced-motion settings need
 * no special case.
 */
export function MarchingAnts({rect,styled,testID}:{rect:DocRect;styled:boolean;testID?:string}){
  const box={position:"absolute",left:rect.x,top:rect.y,width:Math.max(1,rect.w),height:Math.max(1,rect.h)} as const;
  return <View {...HIDDEN} testID={testID} style={box}>
    <View {...{className:joinClasses(styled&&"border-surface-raised")}}
      style={{position:"absolute",left:0,top:0,right:0,bottom:0,borderWidth:1}}/>
    <View {...{className:joinClasses(styled&&"border-text")}}
      style={{position:"absolute",left:0,top:0,right:0,bottom:0,borderWidth:1,borderStyle:"dashed"}}/>
  </View>;
}

/** An in-progress rectangle or ellipse. */
export function DraftBox({rect,ellipse,styled}:{rect:DocRect;ellipse:boolean;styled:boolean}){
  return <View {...HIDDEN} {...{className:joinClasses(styled&&"border-accent bg-accent/10")}}
    style={{position:"absolute",left:rect.x,top:rect.y,width:Math.max(1,rect.w),height:Math.max(1,rect.h),
      borderWidth:2,borderRadius:ellipse?"50%" as never:0 /* radius-exempt: artwork */}}/>;
}

/** An in-progress polygon or lasso path in view units, with optional vertex marks. */
export function DraftPath({points,closed,vertices,closable,styled}:{
  points:readonly DocPoint[];closed:boolean;vertices:boolean;closable:boolean;styled:boolean;
}){
  const drawn=thinPoints(points,MAX_DRAWN_SEGMENTS);
  return <View {...HIDDEN} style={{position:"absolute",left:0,top:0,right:0,bottom:0}}>
    {pathSegments(drawn,closed).map((s,i)=>{
      const rad=s.angle*Math.PI/180;
      const cx=s.x+Math.cos(rad)*s.length/2,cy=s.y+Math.sin(rad)*s.length/2;
      return <View key={i} {...{className:joinClasses(styled&&"bg-accent")}}
        style={{position:"absolute",left:cx-s.length/2,top:cy-1,width:s.length,height:2,transform:[{rotate:`${s.angle}deg`}]}}/>;
    })}
    {vertices?drawn.map(([x,y],i)=>{
      const first=i===0&&closable;
      const d=first?14:8;
      return <View key={"v"+i} {...{className:joinClasses(styled&&"bg-surface-raised border-accent")}}
        style={{position:"absolute",left:x-d/2,top:y-d/2,width:d,height:d,borderWidth:2,borderRadius:first?forgeRadius.sm:forgeHairlineRadius.tick}}/>;
    }):null}
  </View>;
}

/** Crosshair for keyboard targeting on the wand and drop surfaces. */
export function Crosshair({x,y,styled}:{x:number;y:number;styled:boolean}){
  return <View {...HIDDEN} style={{position:"absolute",left:x-12,top:y-12,width:24,height:24}}>
    <View {...{className:joinClasses(styled&&"bg-text")}} style={{position:"absolute",left:11,top:0,width:2,height:24}}/>
    <View {...{className:joinClasses(styled&&"bg-text")}} style={{position:"absolute",top:11,left:0,height:2,width:24}}/>
    <View {...{className:joinClasses(styled&&"border-surface-raised")}}
      style={{position:"absolute",left:7,top:7,width:10,height:10,borderWidth:2,borderRadius:forgeRadius.sm}}/>
  </View>;
}
