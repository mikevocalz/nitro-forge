import {Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {docToScreen,validateViewport,type CanvasViewport} from "./canvas-viewport.ts";
import {formatRulerNumber} from "./ruler-model.ts";
import {smartGuideSummary,validateSmartGuideResult,type SmartGuideResult} from "./smart-guides-model.ts";
import { tokens } from "../tokens.ts";

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
      ?<View key={"a"+i} {...{className:accent}} style={{position:"absolute",left:sx(g.value)-(tokens.borderWidth.hairline / 2),width:tokens.borderWidth.hairline,top:sy(g.from),height:Math.max(1,sy(g.to)-sy(g.from))}}/>
      :<View key={"a"+i} {...{className:accent}} style={{position:"absolute",top:sy(g.value)-(tokens.borderWidth.hairline / 2),height:tokens.borderWidth.hairline,left:sx(g.from),width:Math.max(1,sx(g.to)-sx(g.from))}}/>)}
    {result?.spacings.flatMap((s,i)=>s.gaps.map((m,j)=>{
      const horizontal=s.axis==="x";
      const a=horizontal?sx(m.from):sy(m.from),b=horizontal?sx(m.to):sy(m.to),at=horizontal?sy(m.at):sx(m.at);
      const len=Math.max(1,b-a);
      return <View key={`s${i}-${j}`} style={{position:"absolute",...(horizontal?{left:a,top:at-tokens.spacing.off6,width:len,height:tokens.spacing.fixedInset}:{top:a,left:at-tokens.spacing.off6,height:len,width:tokens.spacing.fixedInset}),
        alignItems:"center",justifyContent:"center"}}>
        <View {...{className:accent}} style={horizontal?{position:"absolute",left:0,right:0,top:tokens.spacing.off5_75,height:tokens.borderWidth.hairline}:{position:"absolute",top:0,bottom:0,left:tokens.spacing.off5_75,width:tokens.borderWidth.hairline}}/>
        <View {...{className:accent}} style={horizontal?{position:"absolute",left:0,top:0,width:tokens.borderWidth.hairline,height:tokens.spacing.fixedInset}:{position:"absolute",top:0,left:0,height:tokens.borderWidth.hairline,width:tokens.spacing.fixedInset}}/>
        <View {...{className:accent}} style={horizontal?{position:"absolute",right:0,top:0,width:tokens.borderWidth.hairline,height:tokens.spacing.fixedInset}:{position:"absolute",bottom:0,left:0,height:tokens.borderWidth.hairline,width:tokens.spacing.fixedInset}}/>
        {len>=28?<Text numberOfLines={1} {...{className:joinClasses(styled&&"bg-accent text-surface-raised rounded-control")}}
          style={{fontSize:tokens.text.micro,lineHeight:tokens.text.body,paddingHorizontal:tokens.spacing.fixedStack,fontVariant:["tabular-nums"],
            ...(horizontal?{position:"absolute",top:tokens.spacing.off14}:{position:"absolute",left:tokens.spacing.off14})}}>{formatGap(s.gap)}</Text>:null}
      </View>;
    }))}
    <Text accessibilityLiveRegion="polite" aria-live="polite"
      style={{position:"absolute",width:tokens.borderWidth.hairline,height:tokens.borderWidth.hairline,overflow:"hidden",opacity:0}}>{summary??""}</Text>
  </View>;
}
