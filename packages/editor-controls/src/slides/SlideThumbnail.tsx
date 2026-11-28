import type {ReactNode} from "react";
import {Text,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {SLIDE_DEFAULT_SIZE,rgbaCss,type SlideObject,type SlideSize,type SlideSummary} from "./slide-model.ts";

/** Props for {@linkcode SlideThumbnail}. */
export interface SlideThumbnailProps {
  readonly slide:SlideSummary;
  /** Width in points; height follows the deck's aspect ratio. */
  readonly width:number;
  readonly size?:SlideSize;
  /** Draws an image object's picture; without it images show as a labelled frame. */
  readonly renderImage?:(src:string,object:SlideObject)=>ReactNode;
  readonly styled?:boolean;
}

/**
 * Small, non-interactive drawing of a slide built from its objects: text in
 * place at scaled size, rectangles in their fill, images through
 * `renderImage`. Hidden from screen readers; the surrounding control speaks
 * the slide's label.
 */
export function SlideThumbnail({slide,width,size=SLIDE_DEFAULT_SIZE,renderImage,styled=true}:SlideThumbnailProps){
  const scale=width/size.width;
  const height=size.height*scale;
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    {...{"aria-hidden":true,className:joinClasses(styled&&!slide.background&&"bg-surface-raised")}}
    style={{width,height,overflow:"hidden",...(slide.background?{backgroundColor:rgbaCss(slide.background)}:null)}}>
    {slide.objects.map(o=><SlideObjectView key={o.id} object={o} scale={scale} renderImage={renderImage} styled={styled}/>)}
  </View>;
}

/** One object drawn at `scale` points per slide unit. Shared by the thumbnail and the canvas. */
export function SlideObjectView({object:o,scale,renderImage,styled}:{
  object:SlideObject;scale:number;renderImage:((src:string,object:SlideObject)=>ReactNode)|undefined;styled:boolean;
}){
  const box={position:"absolute" as const,left:o.x*scale,top:o.y*scale,width:o.w*scale,height:o.h*scale,
    opacity:o.opacity??1,transform:o.rotation?[{rotate:o.rotation+"deg"}]:undefined};
  if(o.kind==="rect")return <View {...{className:joinClasses(styled&&!o.fill&&"bg-text-muted")}}
    style={{...box,...(o.fill?{backgroundColor:rgbaCss(o.fill)}:null)}}/>;
  // The placeholder sits on the slide's own background (document color), so it is an outline with no theme fill.
  if(o.kind==="image")return <View {...{className:joinClasses(styled&&"border border-text-muted")}}
    style={{...box,borderStyle:"dashed",overflow:"hidden",alignItems:"center",justifyContent:"center"}}>
    {o.src&&renderImage?renderImage(o.src,o):scale>=0.5?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>Image</Text>:null}
  </View>;
  const fontSize=Math.max(1,(o.fontSize??18)*scale);
  return <View style={{...box,overflow:"hidden"}}>
    <Text {...{className:joinClasses(styled&&!o.color&&"text-text")}}
      style={{fontSize,lineHeight:fontSize*1.2,fontWeight:o.bold?"700":"400",fontStyle:o.italic?"italic":"normal",
        ...(o.color?{color:rgbaCss(o.color)}:null)}}>{o.text??""}</Text>
  </View>;
}
