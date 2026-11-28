import {Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {docToScreen,validateViewport,type CanvasViewport} from "./canvas-viewport.ts";
import {formatRulerNumber} from "./ruler-model.ts";
import {smartGuideSummary,validateSmartGuideResult,type SmartGuideResult} from "./smart-guides-model.ts";

/** Props for {@linkcode SmartGuides}. */
export interface SmartGuidesProps extends Omit<ViewProps,"children"> {
  readonly viewport:CanvasViewport;
  /**
   * The current drag's guides from `computeSmartGuides`, or `undefined` when
   * nothing is moving. The host commits `result.rect` on release, so what is
   * drawn is what lands.
   */
  readonly result:SmartGuideResult|undefined;
  /** Layer names by id, for the spoken summary. */
  readonly names?:Readonly<Record<string,string>>;
  /** Formats a gap label. @default whole or decimal document pixels, e.g. "24" */
  readonly formatGap?:(gap:number)=>string;
  className?:string;
  unstyled?:boolean;
}

/**
 * Live smart-guide layer (B-05): alignment lines through the edges and
 * centres the moving layer shares with others, and equal-spacing bars with
 * their gap, in the accent color. It takes no touches. One polite live
 * region reads what the layer lines up with, so the snap is heard as well
 * as seen.
 */
export function SmartGuides({viewport,result,names,formatGap=formatRulerNumber,className,unstyled=false,style,...rest}:SmartGuidesProps){
  validateViewport(viewport);
  if(result)validateSmartGuideResult(result);
  const styled=!unstyled;
  const accent=joinClasses(styled&&"bg-accent");
  const sx=(v:number)=>docToScreen(viewport,"x",v),sy=(v:number)=>docToScreen(viewport,"y",v);
  const summary=result?smartGuideSummary(result,names):undefined;
  return <View {...rest} pointerEvents="none" {...{className:joinClasses(className)}}
    style={[{position:"absolute",left:0,top:0,width:viewport.width,height:viewport.height,overflow:"hidden",direction:"ltr"},style]}>
    {result?.alignments.map((g,i)=>g.axis==="x"
      ?<View key={"a"+i} {...{className:accent}} style={{position:"absolute",left:sx(g.value)-0.5,width:1,top:sy(g.from),height:Math.max(1,sy(g.to)-sy(g.from))}}/>
      :<View key={"a"+i} {...{className:accent}} style={{position:"absolute",top:sy(g.value)-0.5,height:1,left:sx(g.from),width:Math.max(1,sx(g.to)-sx(g.from))}}/>)}
    {result?.spacings.flatMap((s,i)=>s.gaps.map((m,j)=>{
      const horizontal=s.axis==="x";
      const a=horizontal?sx(m.from):sy(m.from),b=horizontal?sx(m.to):sy(m.to),at=horizontal?sy(m.at):sx(m.at);
      const len=Math.max(1,b-a);
      return <View key={`s${i}-${j}`} style={{position:"absolute",...(horizontal?{left:a,top:at-6,width:len,height:12}:{top:a,left:at-6,height:len,width:12}),
        alignItems:"center",justifyContent:"center"}}>
        <View {...{className:accent}} style={horizontal?{position:"absolute",left:0,right:0,top:5.5,height:1}:{position:"absolute",top:0,bottom:0,left:5.5,width:1}}/>
        <View {...{className:accent}} style={horizontal?{position:"absolute",left:0,top:0,width:1,height:12}:{position:"absolute",top:0,left:0,height:1,width:12}}/>
        <View {...{className:accent}} style={horizontal?{position:"absolute",right:0,top:0,width:1,height:12}:{position:"absolute",bottom:0,left:0,height:1,width:12}}/>
        {len>=28?<Text numberOfLines={1} {...{className:joinClasses(styled&&"bg-accent text-surface-raised rounded-control")}}
          style={{fontSize:10,lineHeight:14,paddingHorizontal:4,fontVariant:["tabular-nums"],
            ...(horizontal?{position:"absolute",top:14}:{position:"absolute",left:14})}}>{formatGap(s.gap)}</Text>:null}
      </View>;
    }))}
    <Text accessibilityLiveRegion="polite" aria-live="polite"
      style={{position:"absolute",width:1,height:1,overflow:"hidden",opacity:0}}>{summary??""}</Text>
  </View>;
}
