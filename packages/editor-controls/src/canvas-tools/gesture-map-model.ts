/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * crates/core/src/gestures.rs and
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/GestureControlsUi.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (the rule that a way of
 * touching does one thing at most, with the earlier use released when it is
 * given to another; the 0.1 to 1.5 s hold delay and its 0.40 s default; the
 * defaults of four-finger tap for full screen and touch-and-hold for the
 * eyedropper; and "Reset to defaults" bringing back how the app starts out).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Rust/Kotlin to
 * TypeScript as pure functions over host-owned data; per-purpose switch pages
 * became one gesture per quick action; ProCraft's silent reassignment became a
 * visible conflict the user resolves; system-reserved gestures added; edits are
 * a draft committed by Save.
 */

/** Whether a gesture is made with fingers or a stylus. */
export type GestureInput="touch"|"stylus";

/** A gesture the host can recognise. */
export interface GestureDefinition {
  readonly id:string;
  readonly label:string;
  readonly input:GestureInput;
  /** The operating system owns this gesture, e.g. "iPadOS uses it for the Dock". It cannot be mapped. */
  readonly reservedBy?:string;
  /** This device cannot make the gesture, e.g. "This pencil has no squeeze sensor". Mapping it still saves. */
  readonly unavailableReason?:string;
  /** Whether the gesture waits for the hold delay before it fires. */
  readonly held?:boolean;
}
/** A quick action a gesture can trigger. */
export interface QuickActionDefinition {
  readonly id:string;
  readonly label:string;
}
/** Saved mapping: one gesture per action (or none), plus the hold delay. */
export interface GestureMap {
  /** Action id to gesture id; a missing key or `undefined` means no gesture. */
  readonly bindings:Readonly<Record<string,string|undefined>>;
  /** Seconds a held gesture waits, {@linkcode MIN_HOLD_DELAY_S}..{@linkcode MAX_HOLD_DELAY_S}. */
  readonly holdDelayS:number;
}

/** Shortest and longest hold delay, seconds (ProCraft `MIN_DELAY_S`/`MAX_DELAY_S`). */
export const MIN_HOLD_DELAY_S=0.1;
export const MAX_HOLD_DELAY_S=1.5;
/** ProCraft's default hold delay for held gestures, seconds. */
export const DEFAULT_HOLD_DELAY_S=0.4;

/** A common tablet gesture set. Hosts pass their own; `reservedBy` depends on the platform. */
export const TABLET_GESTURES=[
  {id:"two-finger-tap",label:"Two-finger tap",input:"touch"},
  {id:"three-finger-tap",label:"Three-finger tap",input:"touch"},
  {id:"four-finger-tap",label:"Four-finger tap",input:"touch"},
  {id:"long-press",label:"Touch and hold",input:"touch",held:true},
  {id:"three-finger-swipe-down",label:"Three-finger swipe down",input:"touch"},
  {id:"pencil-double-tap",label:"Pencil double-tap",input:"stylus"},
  {id:"pencil-squeeze",label:"Pencil squeeze",input:"stylus"},
  {id:"stylus-button",label:"Stylus side button",input:"stylus"},
] as const satisfies readonly GestureDefinition[];
/** A common quick-action set for a drawing canvas. */
export const CANVAS_QUICK_ACTIONS=[
  {id:"undo",label:"Undo"},
  {id:"redo",label:"Redo"},
  {id:"eyedropper",label:"Eyedropper"},
  {id:"toggle-eraser",label:"Toggle eraser"},
  {id:"hide-ui",label:"Hide interface"},
  {id:"quick-menu",label:"Quick menu"},
  {id:"clear-layer",label:"Clear layer"},
] as const satisfies readonly QuickActionDefinition[];
/** Defaults for {@linkcode TABLET_GESTURES} and {@linkcode CANVAS_QUICK_ACTIONS}. */
export const DEFAULT_GESTURE_MAP:GestureMap={
  bindings:{"undo":"two-finger-tap","redo":"three-finger-tap","eyedropper":"long-press",
    "toggle-eraser":"pencil-double-tap","hide-ui":"four-finger-tap"},
  holdDelayS:DEFAULT_HOLD_DELAY_S,
};

/** A problem that blocks saving a {@linkcode GestureMap}. */
export type GestureConflict=
  |{readonly kind:"duplicate";readonly gestureId:string;readonly actionIds:readonly string[]}
  |{readonly kind:"reserved";readonly gestureId:string;readonly actionId:string;readonly reason:string}
  |{readonly kind:"unknown";readonly gestureId:string;readonly actionId:string};

/** Throws for catalogs the panel cannot show honestly. */
export function validateGestureCatalog(gestures:readonly GestureDefinition[],actions:readonly QuickActionDefinition[]):void{
  if(gestures.length>256||actions.length>256)throw new RangeError("Gesture catalog is too large");
  const valid=(id:string,label:string)=>!!id.trim()&&id.length<=512&&!!label.trim()&&label.length<=1024;
  const seen=new Set<string>();
  for(const g of gestures){
    if(!valid(g.id,g.label)||!["touch","stylus"].includes(g.input))throw new RangeError("Invalid gesture definition");
    if(seen.has(g.id))throw new RangeError(`Duplicate gesture id "${g.id}"`);
    seen.add(g.id);
    if(g.label.trim()==="")throw new RangeError(`Gesture "${g.id}" needs a label`);
    if(g.reservedBy!==undefined&&g.reservedBy.trim()==="")throw new RangeError(`Gesture "${g.id}" reservedBy must say why`);
  }
  const acts=new Set<string>();
  for(const a of actions){
    if(!valid(a.id,a.label))throw new RangeError("Invalid action definition");
    if(acts.has(a.id))throw new RangeError(`Duplicate action id "${a.id}"`);
    acts.add(a.id);
  }
  if(actions.length===0)throw new RangeError("Gesture panel needs at least one action");
}

/** Clamps a hold delay to the allowed range, to hundredths of a second. */
export function clampHoldDelay(s:number):number{
  if(!Number.isFinite(s))throw new RangeError("Hold delay must be a number");
  return Math.round(Math.min(Math.max(s,MIN_HOLD_DELAY_S),MAX_HOLD_DELAY_S)*100)/100;
}

/** Every conflict in `map`, duplicates first, in action order. */
export function findGestureConflicts(map:GestureMap,gestures:readonly GestureDefinition[],actions:readonly QuickActionDefinition[]):readonly GestureConflict[]{
  const byGesture=new Map<string,string[]>();
  const out:GestureConflict[]=[];
  for(const a of actions){
    const g=map.bindings[a.id];
    if(g===undefined)continue;
    const def=gestures.find(x=>x.id===g);
    if(!def){out.push({kind:"unknown",gestureId:g,actionId:a.id});continue;}
    if(def.reservedBy!==undefined)out.push({kind:"reserved",gestureId:g,actionId:a.id,reason:def.reservedBy});
    byGesture.set(g,[...(byGesture.get(g)??[]),a.id]);
  }
  const dupes:GestureConflict[]=[...byGesture].filter(([,ids])=>ids.length>1)
    .map(([gestureId,actionIds])=>({kind:"duplicate",gestureId,actionIds}));
  return [...dupes,...out];
}

const labelOf=(list:readonly {id:string;label:string}[],id:string)=>list.find(x=>x.id===id)?.label??id;
/** The sentence shown for a conflict, e.g. "Two-finger tap is set for both Undo and Hide interface". */
export function conflictMessage(c:GestureConflict,gestures:readonly GestureDefinition[],actions:readonly QuickActionDefinition[]):string{
  const g=labelOf(gestures,c.gestureId);
  if(c.kind==="duplicate"){
    const names=c.actionIds.map(id=>labelOf(actions,id));
    const list=names.length===2?`${names[0]} and ${names[1]}`:`${names.slice(0,-1).join(", ")} and ${names[names.length-1]}`;
    return `${g} is set for both ${list}`;
  }
  if(c.kind==="reserved")return `${g} is reserved: ${c.reason}`;
  return `${labelOf(actions,c.actionId)} uses a gesture this device does not offer`;
}
/** The conflicts that involve `actionId`. */
export function conflictsForAction(conflicts:readonly GestureConflict[],actionId:string):readonly GestureConflict[]{
  return conflicts.filter(c=>c.kind==="duplicate"?c.actionIds.includes(actionId):c.actionId===actionId);
}

/** `map` with `actionId` set to `gestureId` (or cleared). Other actions are left alone, so conflicts show. */
export function assignGesture(map:GestureMap,actionId:string,gestureId:string|undefined):GestureMap{
  const bindings={...map.bindings};
  if(gestureId===undefined)delete bindings[actionId];else Object.defineProperty(bindings,actionId,{value:gestureId,enumerable:true,configurable:true,writable:true});
  return {...map,bindings};
}
/** Resolves a duplicate the ProCraft way: `actionId` keeps `gestureId`, every other action loses it. */
export function keepGestureFor(map:GestureMap,actionId:string,gestureId:string):GestureMap{
  const bindings:Record<string,string|undefined>=Object.create(null);
  for(const [a,g] of Object.entries(map.bindings))if(g!==undefined&&(g!==gestureId||a===actionId))bindings[a]=g;
  bindings[actionId]=gestureId;
  return {...map,bindings};
}
/** Whether two maps bind the same gestures with the same delay. */
export function sameGestureMap(a:GestureMap,b:GestureMap):boolean{
  if(a.holdDelayS!==b.holdDelayS)return false;
  const keys=new Set([...Object.keys(a.bindings),...Object.keys(b.bindings)]);
  for(const k of keys)if(a.bindings[k]!==b.bindings[k])return false;
  return true;
}
/** Why Save is unavailable, or `undefined` when it can run. */
export function saveProblem(draft:GestureMap,saved:GestureMap,conflicts:readonly GestureConflict[]):string|undefined{
  if(conflicts.length>0)return conflicts.length===1?"Fix the conflict above to save":`Fix the ${conflicts.length} conflicts above to save`;
  if(sameGestureMap(draft,saved))return "No changes to save";
  return undefined;
}
/** Whether any action is bound to a held gesture, so the hold delay matters. */
export function usesHeldGesture(map:GestureMap,gestures:readonly GestureDefinition[]):boolean{
  return Object.values(map.bindings).some(id=>gestures.some(g=>g.id===id&&g.held));
}
/** "0.40 s". */
export function formatHoldDelay(s:number):string{
  return s.toFixed(2)+" s";
}

/** Saved mappings may contain conflicts for the panel to repair, but must be bounded data. */
export function validateGestureMap(map:GestureMap):void{
 if(!Number.isFinite(map.holdDelayS)||map.holdDelayS<MIN_HOLD_DELAY_S||map.holdDelayS>MAX_HOLD_DELAY_S||Object.keys(map.bindings).length>256||Object.entries(map.bindings).some(([a,g])=>!a.trim()||a.length>512||g!==undefined&&(!g.trim()||g.length>512)))throw new RangeError('Invalid gesture map');
}
