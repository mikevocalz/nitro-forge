/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/GestureControlsUi.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`GestureControls` and
 * `DelayRow`: a page of ways of touching per action, a hold delay row that greys
 * out while no held gesture is on, and "Reset to defaults").
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Compose to a controlled
 * React Native panel on theme tokens and the kit's Select, Button and
 * PrecisionScrubber; edits are a draft saved or cancelled as a whole; conflicts are
 * shown instead of reassigned silently.
 */
import {useEffect,useRef} from "react";
import {Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Button} from "@nyc-tron/ui/components/Button";
import {Select} from "@nyc-tron/ui/components/Select";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {
 MAX_HOLD_DELAY_S,MIN_HOLD_DELAY_S,assignGesture,clampHoldDelay,conflictMessage,conflictsForAction,findGestureConflicts,
 keepGestureFor,sameGestureMap,saveProblem,usesHeldGesture,validateGestureCatalog,validateGestureMap,
 type GestureDefinition,type GestureMap,type QuickActionDefinition,
} from "./gesture-map-model.ts";

/** Props for {@linkcode GestureCustomizationPanel}. */
export interface GestureCustomizationPanelProps extends Omit<ViewProps,"children">,ScopedControlProps {
 /** Gestures this device can recognise, in menu order. */
 gestures:readonly GestureDefinition[];
 /** Quick actions, one row each. */
 actions:readonly QuickActionDefinition[];
 /** The saved mapping. Edits stay in a draft until Save. */
 value:GestureMap;
 /** What "Reset to defaults" restores into the draft. */
 defaults:GestureMap;
 /** Save with no conflicts and at least one change. One call per press. */
 onSave:(map:GestureMap,signal?:AbortSignal)=>void|Promise<unknown>;
 /** Cancel: the draft is dropped. The host closes the panel. */
 onCancel:()=>void;
 /** @default "Gesture controls" */
 label?:string;
 className?:string;
 unstyled?:boolean;
}
type Local={draft:GestureMap|null;notice:string|undefined};
const NONE="";

/**
 * Gesture customisation (B-34): one row per quick action with a gesture menu,
 * a hold delay for held gestures, Reset to defaults, Cancel and Save. Changes
 * stay in a local draft until Save, which sends the whole map once; Cancel drops
 * them. A gesture set for two actions, or one the system reserves, is shown as
 * a conflict on each row it touches and blocks Save until resolved; a duplicate
 * offers "Keep for <action>", which releases the gesture from the other rows.
 */
export function GestureCustomizationPanel({scope='gesture-map',revision=0,...props}:GestureCustomizationPanelProps&{actionError?:string|null;busy?:boolean}){
 validateGestureCatalog(props.gestures,props.actions);validateGestureMap(props.value);validateGestureMap(props.defaults);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.gestures,props.actions]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <GestureCustomizationPanelBody key={owner} {...props} actionError={guard.error} busy={guard.pending}
  onSave={value=>guard.run('save',(host,signal)=>host.onSave(value,signal))} onCancel={()=>guard.current()?.onCancel()}/>;
}
function GestureCustomizationPanelBody({
 actionError=null,busy=false,disabledReason,gestures,actions,value,defaults,onSave,onCancel,label="Gesture controls",className,unstyled=false,...rest
}:GestureCustomizationPanelProps&{actionError?:string|null;busy?:boolean}){
 validateGestureCatalog(gestures,actions);
 const styled=!unstyled;
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({draft:null,notice:undefined}));
 const store=local.current;
 const draftState=useStore(store,s=>s.draft);
 const notice=useStore(store,s=>s.notice);
 // A new saved value (after Save, or from elsewhere) replaces the draft.
 useEffect(()=>{store.setState({draft:null});},[value,store]);
 const draft=draftState??value;
 const edit=(next:GestureMap,message?:string)=>{if(busy||disabledReason!==undefined)return;store.setState({draft:sameGestureMap(next,value)?null:next,notice:message});};
 const conflicts=findGestureConflicts(draft,gestures,actions);
 const unavailable=busy||disabledReason!==undefined;
 const blocked=disabledReason??(busy?"Saving gestures":saveProblem(draft,value,conflicts));
 const dirty=!sameGestureMap(draft,value);
 const held=usesHeldGesture(draft,gestures);
 const gestureLabel=(id:string)=>gestures.find(g=>g.id===id)?.label??id;
 const actionLabel=(id:string)=>actions.find(a=>a.id===id)?.label??id;

 return <View {...rest} role="group" aria-label={label}
  {...{className:joinClasses("gap-3",styled&&"rounded-card border border-border bg-surface-raised p-4",className)}}>
  <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
  {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Saving gestures"}</Text>:null}
  <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
   <Text role="heading" aria-level={2} {...{className:joinClasses(styled&&"text-text text-lg font-semibold")}}>{label}</Text>
   <Text {...{className:joinClasses(styled&&"text-xs",styled&&(dirty?"text-text":"text-text-muted"))}}>
    {dirty?"Unsaved changes":"All changes saved"}</Text>
  </View>
  {actions.map((action,index)=>{
   const bound=draft.bindings[action.id];
   const mine=conflictsForAction(conflicts,action.id);
   const errorText=mine.length?mine.map(c=>conflictMessage(c,gestures,actions)).join(". "):undefined;
   const def=gestures.find(g=>g.id===bound);
   const dupe=mine.find(c=>c.kind==="duplicate");
   return <View key={action.id} style={{gap:6,zIndex:actions.length-index}}>
    <Select disabled={unavailable} label={action.label} value={bound??NONE} unstyled={unstyled}
     options={[{value:NONE,label:"No gesture"},...gestures.map(g=>({value:g.id,
      label:g.reservedBy?`${g.label} (reserved)`:g.unavailableReason?`${g.label} (not on this device)`:g.label,
      disabled:g.reservedBy!==undefined&&g.id!==bound}))]}
     errorText={errorText} hint={!errorText&&def?.unavailableReason?def.unavailableReason:undefined}
     onValueChange={v=>edit(assignGesture(draft,action.id,v===NONE?undefined:v))}/>
    {dupe&&dupe.kind==="duplicate"?<Button size="sm" variant="secondary" unstyled={unstyled} style={{alignSelf:"flex-start"}}
     title={`Keep ${gestureLabel(dupe.gestureId)} for ${action.label}`}
     onPress={()=>edit(keepGestureFor(draft,action.id,dupe.gestureId),
      `${gestureLabel(dupe.gestureId)} now runs ${action.label} only. ${dupe.actionIds.filter(a=>a!==action.id).map(actionLabel).join(", ")} has no gesture.`)}/>:null}
   </View>;
  })}
  <View style={{gap:4}}>
   <PrecisionScrubber label="Hold delay" unit=" s" value={draft.holdDelayS} min={MIN_HOLD_DELAY_S} max={MAX_HOLD_DELAY_S} step={0.05}
    disabled={!held||unavailable} unstyled={unstyled} onCommit={v=>edit({...draft,holdDelayS:clampHoldDelay(v)})}/>
   {!held?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>
    Applies when an action uses a held gesture such as Touch and hold.</Text>:null}
  </View>
  <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center"}}>
   <Button variant="secondary" title="Reset to defaults" disabled={unavailable} unstyled={unstyled}
    onPress={()=>sameGestureMap(draft,defaults)?store.setState({notice:"Gestures are already at their defaults"})
     :edit(defaults,"Defaults restored. Save to keep them, or Cancel to go back.")}/>
   <View style={{flexGrow:1}}/>
   <Button variant="ghost" title="Cancel" disabled={unavailable} unstyled={unstyled}
    onPress={()=>{store.setState({draft:null,notice:undefined});onCancel();}}/>
   <Button title="Save" unstyled={unstyled} disabled={blocked!==undefined} accessibilityHint={blocked}
    onPress={()=>{if(blocked)return;store.setState({notice:"Saving gestures"});onSave(draft);}}/>
  </View>
  <Text aria-live="polite" accessibilityLiveRegion="polite"
   {...{className:joinClasses(styled&&"text-xs",styled&&(conflicts.length?"text-danger":"text-text-muted"))}}>
   {conflicts.length?blocked:notice??(dirty?"Save to apply these gestures.":blocked??"")}</Text>
 </View>;
}
