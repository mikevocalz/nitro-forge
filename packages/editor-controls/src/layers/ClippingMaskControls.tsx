/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/LayersPanel.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`LayerRow` and
 * `LayerOptions`: the 18 dp clip indent holding a clip glyph, and the
 * "Clipping Mask" option that toggles a layer's clipping).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Compose to React
 * Native; the glyph is drawn with token-colored views, and the toggle names
 * its base and stays visible with a reason when the layer cannot clip.
 * Modified for NYC-Tron UI on 2026-11-06: added document ownership and permission guards; original licenses retained.
 */
import {forgeHairlineRadius} from "../radius.ts";
import {useLayoutEffect,useRef} from 'react';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {PanelButton,Reason} from "./panel-button.tsx";
import {CLIP_INDENT,clipReason,clipToggleLabel,type ClipLayer,type SetClippedOp} from "./clipping-model.ts";
import { tokens } from "../tokens.ts";

/** Props for {@linkcode ClipToggle}. */
export interface ClipToggleProps extends Omit<ViewProps,"children"> {
  scope?:string;revision?:string|number;disabled?:boolean;
  /** Layers top to bottom (index 0 is the top), as in `LayerStack`. */
  layers:readonly ClipLayer[];
  /** The layer the switch acts on. */
  layerId:string;
  /** `setClipped`. */
  onSetClipped:(op:SetClippedOp,signal?:AbortSignal)=>void|Promise<unknown>;
  className?:string;
  unstyled?:boolean;
}

/**
 * Clip/unclip switch for one layer (B-13). Its label names the base it clips
 * to ("Clip to Photo"). On the bottom layer, or when every layer below is
 * already clipped, it stays visible and says why it cannot run.
 */
export function ClipToggle({scope="clipping",revision=0,disabled=false,layers,layerId,onSetClipped,className,unstyled=false,...rest}:ClipToggleProps){
  const layer=layers.find(l=>l.id===layerId);
  if(!layer)throw new RangeError("Unknown layer: "+layerId);
  if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid clipping identity');
  const blocked=clipReason(layers,layerId),boundary=JSON.stringify([scope,revision,disabled,layers,layerId]),action=useOwnedAction(boundary),pending=action.pending!==null,request=useRef<symbol|null>(null),committed=useRef<null|{boundary:string;onSetClipped:typeof onSetClipped}>(null);
  useLayoutEffect(()=>{committed.current={boundary,onSetClipped};});useLayoutEffect(()=>{request.current=null;},[boundary]);useLayoutEffect(()=>()=>{committed.current=null;},[]);
  const reason=disabled?'Clipping editing is disabled':pending?'Updating clipping':blocked;
  const toggle=()=>{const p=committed.current;if(!p||p.boundary!==boundary||reason||request.current)return;const token=Symbol();request.current=token;void action.run(layerId,signal=>p.onSetClipped({id:layerId,clipped:!layer.clipped},signal)).finally(()=>{if(request.current===token)request.current=null;});};
  const styled=!unstyled;
  const identity=JSON.stringify([scope,revision,disabled,layerId,layers.map(item=>[item.id,item.parent,item.parentId,item.locked,item.id===layerId?null:item.clipped])]);
  return <View key={identity} {...rest} {...{className:joinClasses("gap-1",className)}}>
    <PanelButton role="switch" label={clipToggleLabel(layers,layerId)} checked={layer.clipped} reason={reason}
      styled={styled} icon={<ClipGlyph styled={styled}/>}
      onPress={toggle}/>
    <Reason text={reason} styled={styled}/>
    <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
  </View>;
}

/** Props for {@linkcode ClipIndicator}. */
export interface ClipIndicatorProps extends Omit<ViewProps,"children"> {
  unstyled?:boolean;
}

/**
 * The 18pt indent and clip glyph at the start of a clipped layer's row, so the
 * row reads as hanging off the base below it. Decorative: the row's label
 * says "clipped to <base>". `LayerStack` draws it for rows with `clippedTo`.
 */
export function ClipIndicator({unstyled=false,style,...rest}:ClipIndicatorProps){
  return <View {...rest} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    {...{"aria-hidden":true}} style={[{width:CLIP_INDENT,alignSelf:"stretch",alignItems:"center",justifyContent:"center"},style]}>
    <ClipGlyph styled={!unstyled}/>
  </View>;
}

/**
 * A short down arrow: the layer hangs onto the one below it. Symmetric, so it
 * reads the same in left-to-right and right-to-left rows.
 */
function ClipGlyph({styled}:{styled:boolean}){
  const ink=joinClasses(styled&&"bg-text-muted");
  return <View pointerEvents="none" style={{width:tokens.spacing.fixedInset,height:tokens.spacing.fixedGroup,alignItems:"center"}}>
    <View {...{className:ink}} style={{position:"absolute",top:tokens.borderWidth.hairline,width:tokens.spacing.off1_5,height:tokens.spacing.fixedInset,borderRadius:forgeHairlineRadius.tick}}/>
    <View {...{className:ink}} style={{position:"absolute",top:tokens.spacing.off10,left:tokens.spacing.off1_5,width:tokens.spacing.off6,height:tokens.spacing.off1_5,borderRadius:forgeHairlineRadius.tick,transform:[{rotate:"45deg"}]}}/>
    <View {...{className:ink}} style={{position:"absolute",top:tokens.spacing.off10,right:tokens.spacing.off1_5,width:tokens.spacing.off6,height:tokens.spacing.off1_5,borderRadius:forgeHairlineRadius.tick,transform:[{rotate:"-45deg"}]}}/>
  </View>;
}
