/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/LayersPanel.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`Thumb`: the preview
 * fitted in a rounded box over the transparency checkerboard, and a mask's
 * preview on a plain surface instead of the checkerboard).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Compose to a React
 * Native component; colors come from theme tokens, and loading, empty,
 * couldn't-render and stale-while-revalidate states were added.
 */
import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {useEffect,useLayoutEffect,useMemo,useRef,useSyncExternalStore} from "react";
import {Image,PixelRatio,Platform,Pressable,Text,View,type ViewProps} from "react-native";
import {webKey,isModified} from "@nyc-tron/ui/components/forms/choice-keys";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {
  checkerCells,fitContain,rasterToImage,sharedThumbnailCache,thumbnailAccessibilityLabel,thumbnailRequestMax,thumbnailCacheId,
  type ThumbnailCache,type ThumbnailImage,type ThumbnailSource,type ThumbnailState,
} from "./layer-thumbnail-model.ts";

/** Props for {@linkcode LayerThumbnail}. */
export interface LayerThumbnailProps extends Omit<ViewProps,"children"> {
  /** Pixels in hand, or a loader keyed by id and revision. */
  source:ThumbnailSource;
  /** Document/workspace cache namespace, combined with an optional loader source namespace. */
  scope?:string;
  /**
   * Box size in points; the preview is fitted inside it.
   * @default 28
   */
  width?:number;
  /** @default 28 */
  height?:number;
  /**
   * `content` draws transparency as a checkerboard. `mask` draws on a plain
   * surface, since a mask preview is opaque gray.
   * @default "content"
   */
  variant?:"content"|"mask";
  /**
   * Spoken description, e.g. "Skyline preview". With a label the thumbnail is
   * its own screen-reader image; without one it is decorative (the row that
   * holds it speaks for it, as in `LayerStack`).
   */
  label?:string;
  /** @default sharedThumbnailCache */
  cache?:ThumbnailCache;
  /** Device pixels per point used to size the request. @default PixelRatio.get() */
  pixelRatio?:number;
  className?:string;
  unstyled?:boolean;
}

const SETTLED:ThumbnailState={status:"loading"};
const noop=()=>()=>{};

/**
 * Async, cached preview of a layer, mask or artboard (B-10). With a loader
 * source it requests `max` = box edge x pixel ratio once per id + revision,
 * shows a skeleton until the first preview arrives, keeps the previous
 * preview on screen while a new revision loads, and shows "couldn't render"
 * (distinct from an empty, fully transparent layer) when the loader rejects.
 * Pixels render through an `Image` with a PNG data URI built in the model.
 */
export function LayerThumbnail({
  source,scope="",width=28,height=28,variant="content",label,cache=sharedThumbnailCache,pixelRatio,
  className,unstyled=false,style,...rest
}:LayerThumbnailProps){
  const ratio=pixelRatio??PixelRatio.get();
  const max=thumbnailRequestMax(width,height,ratio);
  const loader=source.kind==="loader"?source:undefined;
  const cacheId=loader?thumbnailCacheId(loader.id,JSON.stringify([scope,loader.scope??''])):'';
  const mounted=useRef(false),committed=useRef({cacheId,revision:loader?.revision,max,cache});
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useLayoutEffect(()=>{committed.current={cacheId,revision:loader?.revision,max,cache};});
  const state=useSyncExternalStore(loader?cache.subscribe:noop,
    ()=>loader?cache.get(cacheId,loader.revision,max):SETTLED,
    ()=>loader?cache.get(cacheId,loader.revision,max):SETTLED);
  useEffect(()=>{if(loader)cache.request(cacheId,loader.revision,max,(_,edge,signal)=>loader.load(loader.id,edge,signal));},
    [cache,cacheId,loader?.revision,max,loader?.load,state]);
  const raster=source.kind==="pixels"?source.raster:undefined;
  const direct=useMemo(()=>raster?rasterToImage(raster,max):undefined,[raster,max]);
  const shown:ThumbnailState=direct?{status:"ready",image:direct}:state;
  const image=shown.status==="ready"?shown.image:shown.stale;
  const styled=!unstyled;
  const retry=loader&&shown.status==="error"?()=>{const p=committed.current;if(mounted.current&&p.cache===cache&&p.cacheId===cacheId&&p.revision===loader.revision&&p.max===max)cache.retry(cacheId,loader.revision,max);}:undefined;
  const a11y=label===undefined
    ?{importantForAccessibility:"no-hide-descendants" as const,accessibilityElementsHidden:true,"aria-hidden":true}
    :{accessible:true,accessibilityRole:"image" as const,accessibilityLabel:thumbnailAccessibilityLabel(label,shown),
      "aria-busy":shown.status==="loading",
      accessibilityHint:retry?'Activate to retry this preview':undefined,
      ...(Platform.OS==='web'&&retry?{tabIndex:0 as const,onKeyDown:(event:unknown)=>{const raw=event as {target?:unknown;currentTarget?:unknown};if(raw.target!==raw.currentTarget)return;const key=webKey(event);if(!isModified(key)&&(key.key==='Enter'||key.key===' ')){key.preventDefault();retry();}}}:{}),
      accessibilityActions:retry?[{name:"activate",label:"Retry preview"}]:[],
      onAccessibilityAction:()=>retry?.()};
  return <View {...rest} {...a11y}
    {...{className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border",
      styled&&(image||variant==="mask"?"bg-surface-raised":"bg-surface-sunken"),className)}}
    style={[{width,height,alignItems:"center",justifyContent:"center"},style]}>
    {variant==="content"&&image?<Checker box={fitContain(image.width,image.height,width,height)} styled={styled}/>:null}
    {image&&!image.empty?<Picture image={image} width={width} height={height}/>:null}
    {!image&&shown.status==="loading"?<Skeleton width={width} height={height} styled={styled}/>:null}
    {shown.status==="error"&&!image?<Failure width={width} height={height} styled={styled} onRetry={label===undefined?undefined:retry}/>:null}
    {shown.status==="error"&&image?<StaleMark styled={styled}/>:null}
  </View>;
}

function Picture({image,width,height}:{image:ThumbnailImage;width:number;height:number}){
  const fit=fitContain(image.width,image.height,width,height);
  return <Image source={{uri:image.uri}} accessibilityIgnoresInvertColors resizeMode="stretch"
    style={{position:"absolute",left:fit.x,top:fit.y,width:fit.width,height:fit.height}}/>;
}

/** Drawn only under the fitted image, so letterbox bars read as the frame, not as transparent pixels. */
function Checker({box,styled}:{box:{x:number;y:number;width:number;height:number};styled:boolean}){
  const {cell,cells}=checkerCells(box.width,box.height);
  return <View pointerEvents="none" style={{position:"absolute",left:box.x,top:box.y,width:box.width,height:box.height,overflow:"hidden"}}>
    {cells.map(c=><View key={c.x+","+c.y} {...{className:joinClasses(styled&&"bg-border")}}
      style={{position:"absolute",left:c.x,top:c.y,width:cell,height:cell,opacity:0.6}}/>)}
  </View>;
}

/** Static on purpose: a list of pulsing thumbnails is noise, and nothing moves under reduced motion. */
function Skeleton({width,height,styled}:{width:number;height:number;styled:boolean}){
  const bar=Math.max(4,Math.round(Math.min(width,height)/6));
  return <View pointerEvents="none" style={{width:"70%",gap:bar/2,alignItems:"flex-start"}}>
    <View {...{className:joinClasses(styled&&"bg-border")}} style={{width:"100%",height:bar,borderRadius:forgeHairlineRadius.tick,opacity:0.7}}/>
    {height>=40?<View {...{className:joinClasses(styled&&"bg-border")}} style={{width:"60%",height:bar,borderRadius:forgeHairlineRadius.tick,opacity:0.7}}/>:null}
  </View>;
}

/** An exclamation mark in the danger token; large boxes also say so in words and offer a retry. */
function Failure({width,height,styled,onRetry}:{width:number;height:number;styled:boolean;onRetry:(()=>void)|undefined}){
  const roomy=width>=96&&height>=84;
  const mark=<View pointerEvents="none" {...{className:joinClasses(styled&&"border-danger")}}
    style={{width:16,height:16,borderRadius:forgeRadius.sm,borderWidth:1.5,alignItems:"center",justifyContent:"center",gap:1.5}}>
    <View {...{className:joinClasses(styled&&"bg-danger")}} style={{width:2,height:6,borderRadius:forgeHairlineRadius.tick}}/>
    <View {...{className:joinClasses(styled&&"bg-danger")}} style={{width:2,height:2,borderRadius:forgeHairlineRadius.tick}}/>
  </View>;
  if(!roomy)return mark;
  return <View style={{alignItems:"center",gap:4,paddingHorizontal:6}}>
    {mark}
    <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-xs")}}>Couldn't render</Text>
    {onRetry?<Pressable accessibilityRole="button" accessibilityLabel="Retry preview" onPress={onRetry}
      {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
      style={{minHeight:44,minWidth:44,paddingHorizontal:8,alignItems:"center",justifyContent:"center"}}>
      <Text {...{className:joinClasses(styled&&"text-text-muted text-xs font-semibold")}}>Retry</Text>
    </Pressable>:null}
  </View>;
}

/** Corner dot on a stale preview whose newer revision failed, so the old picture is not mistaken for current. */
function StaleMark({styled}:{styled:boolean}){
  return <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-danger")}}
    style={{position:"absolute",top:2,end:2,width:7,height:7,borderRadius:forgeHairlineRadius.tick}}/>;
}
