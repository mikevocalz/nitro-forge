/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/LayersPanel.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`LayerRow`: a clipped
 * layer's row indented by 18 dp with a clip glyph before its thumbnail, and
 * group levels indented 21 dp each).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Kotlin to TypeScript
 * pure functions; base resolution follows the Prism rule (a clipped layer clips
 * to the nearest unclipped sibling below it), and the reasons a layer cannot
 * clip are spelled out instead of the option being hidden.
 * Modified for NYC-Tron UI on 2026-11-06: validated bounded hierarchy metadata and inherited locks.
 */

/** The fields clipping needs from each layer. Index 0 is the topmost layer. */
export interface ClipLayer {
  readonly id:string;
  readonly name:string;
  readonly clipped:boolean;
  /** Group id, or `null`/`undefined` at the document root. Clipping only looks at siblings. */
  readonly parent?:string|null;
  /** Matches LayerRow.parentId. Supplying both requires the same identity. */
  readonly parentId?:string|null;
  readonly locked?:boolean;
}

/** `setClipped` argument. */
export interface SetClippedOp {readonly id:string;readonly clipped:boolean}

/** How a layer takes part in clipping. */
export type ClipRole=
  |{readonly kind:"none"}
  |{readonly kind:"base";readonly clippedIds:readonly string[]}
  |{readonly kind:"clipped";readonly baseId:string;readonly baseName:string}
  /** Marked clipped but with no unclipped sibling below; the engine draws it unclipped. */
  |{readonly kind:"orphan"};

/** ProCraft's indent for a clipped row, 18 dp; it holds the clip glyph. */
export const CLIP_INDENT=18;
/** ProCraft's indent per group level, 21 dp. */
export const GROUP_INDENT=21;

/** Bounded metadata validation also covers rows not selected by the current editor. */
export function validateClippingLayers(layers:readonly ClipLayer[]):void {
 if(layers.length>500)throw new RangeError('Too many clipping layers');const byId=new Map<string,ClipLayer>();
 const valid=(value:string)=>typeof value==='string'&&!!value.trim()&&value.length<=512;
 for(const layer of layers){if(byId.has(layer.id))throw new RangeError('Duplicate clipping layer id: '+layer.id);if(!valid(layer.id)||!valid(layer.name)||typeof layer.clipped!=='boolean'||layer.locked!==undefined&&typeof layer.locked!=='boolean'||layer.parent!=null&&!valid(layer.parent)||layer.parentId!=null&&!valid(layer.parentId)||layer.parent!==undefined&&layer.parentId!==undefined&&(layer.parent??null)!==(layer.parentId??null))throw new RangeError('Invalid clipping layer');byId.set(layer.id,layer);}
 const done=new Set<string>();for(const layer of layers){const path=new Set<string>();let current:ClipLayer|undefined=layer;while(current&&!done.has(current.id)){if(path.has(current.id))throw new RangeError('Cyclic clipping hierarchy');path.add(current.id);const parent=clippingParent(current);current=parent===null?undefined:byId.get(parent);}for(const id of path)done.add(id);}
}
export function clippingParent(layer:ClipLayer):string|null{return layer.parentId??layer.parent??null;}
function clippingLocked(layers:readonly ClipLayer[],layer:ClipLayer):boolean {const byId=new Map(layers.map(item=>[item.id,item]));let current:ClipLayer|undefined=layer;while(current){if(current.locked)return true;const parent=clippingParent(current);current=parent===null?undefined:byId.get(parent);}return false;}

/**
 * Each layer's clipping role. A clipped layer clips to the nearest unclipped
 * sibling below it (a higher index with the same parent); that sibling is a base.
 */
export function resolveClipping(layers:readonly ClipLayer[]):Map<string,ClipRole>{
  validateClippingLayers(layers);
  const roles=new Map<string,ClipRole>();
  const pending=new Map<string,string[]>();
  const parentOf=clippingParent;
  // Walk bottom to top so each clipped layer meets its base first.
  const baseBelow=new Map<string|null,ClipLayer>();
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i]!;
    if(roles.has(layer.id))throw new RangeError("Duplicate layer id: "+layer.id);
    const parent=parentOf(layer);
    if(!layer.clipped){
      baseBelow.set(parent,layer);
      roles.set(layer.id,{kind:"none"});
      continue;
    }
    const base=baseBelow.get(parent);
    if(!base){roles.set(layer.id,{kind:"orphan"});continue;}
    roles.set(layer.id,{kind:"clipped",baseId:base.id,baseName:base.name});
    const list=pending.get(base.id)??[];
    list.unshift(layer.id);
    pending.set(base.id,list);
  }
  for(const [baseId,clippedIds] of pending)roles.set(baseId,{kind:"base",clippedIds});
  return roles;
}

/**
 * Why `id` cannot be clipped, or `undefined` when it can. Unclipping an unlocked
 * layer is always allowed. A layer with no unclipped sibling below it has nothing to clip to;
 * for the bottom layer of the document or a group that is always the case.
 * @throws RangeError when `id` is unknown.
 */
export function clipReason(layers:readonly ClipLayer[],id:string):string|undefined{
  validateClippingLayers(layers);
  const index=layers.findIndex(l=>l.id===id);
  if(index<0)throw new RangeError("Unknown layer: "+id);
  const layer=layers[index]!;
  if(clippingLocked(layers,layer))return "Unlock the layer or its group to edit clipping";
  if(layer.clipped)return undefined;
  const parent=clippingParent(layer);
  const below=layers.slice(index+1).filter(l=>clippingParent(l)===parent);
  if(below.length===0)return "The bottom layer has no layer below to clip to";
  if(below.every(l=>l.clipped))return "Every layer below is already clipped";
  return undefined;
}

/** The base `id` would clip to if it were clipped now, or `undefined` when there is none. */
export function clipTarget(layers:readonly ClipLayer[],id:string):ClipLayer|undefined{
  validateClippingLayers(layers);
  const index=layers.findIndex(l=>l.id===id);
  if(index<0)throw new RangeError("Unknown layer: "+id);
  const parent=clippingParent(layers[index]!);
  return layers.slice(index+1).find(l=>clippingParent(l)===parent&&!l.clipped);
}

/** Visible label of the clip switch: names the base when there is one. */
export function clipToggleLabel(layers:readonly ClipLayer[],id:string):string{
  const target=clipTarget(layers,id);
  return target?"Clip to "+target.name:"Clip to layer below";
}

/** Phrase a row appends to its spoken label, e.g. "clipped to Photo" or "clipping base for 2 layers". */
export function clipAccessibilityPhrase(role:ClipRole|undefined):string|undefined{
  if(!role)return undefined;
  if(role.kind==="clipped")return "clipped to "+role.baseName;
  if(role.kind==="base")return "clipping base for "+role.clippedIds.length+(role.clippedIds.length===1?" layer":" layers");
  if(role.kind==="orphan")return "clipped, but nothing below to clip to";
  return undefined;
}
