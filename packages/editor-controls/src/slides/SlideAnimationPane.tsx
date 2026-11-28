import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {useLayoutEffect} from 'react';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {Pressable,ScrollView,Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {CloseMark,OFFICE_TOUCH_TARGET} from "../office/office-controls.tsx";
import {effectLabel,formatSeconds,parseSeconds,playOrder,timelineEnd,type AnimationCategory,type AnimationEffect,type SlideAnimation} from "./animation-model.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** Props for {@linkcode SlideAnimationPane}. */
export interface SlideAnimationPaneProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly animations:readonly SlideAnimation[];
  /** Effects the host's engine plays. Categories with no effect are not shown. */
  readonly effects:readonly AnimationEffect[];
  /** Names an object for the list ("Title", "Rectangle 2"). */
  readonly objectLabel:(objectId:string)=>string;
  /** The object selected on the canvas; new animations apply to it. */
  readonly selectedObjectId?:string;
  /** Adds an animation. Rejecting keeps the form and shows the message. */
  readonly onAdd?:((animation:{objectId:string;kind:string;startS:number;durationS:number})=>void|Promise<unknown>)|undefined;
  /** Removes the animation at the engine's `index`. */
  readonly onRemove?:((index:number)=>void|Promise<unknown>)|undefined;
  /** Plays the slide's animations once on the canvas. */
  readonly onPreview?:(()=>void)|undefined;
  readonly onTimingCommit?:((index:number,value:{startS:number;durationS:number;trigger:'on-click'|'with-previous'|'after-previous'})=>unknown)|undefined;
  readonly onOrderCommit?:((indices:readonly number[])=>unknown)|undefined;
  readonly supportedTriggers?:readonly ('on-click'|'with-previous'|'after-previous')[];
  disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Local={kind:string|undefined;start:string;duration:string;error:string|undefined;busy:boolean;activeIndex:number|null};

const CATEGORY_LABEL:Record<AnimationCategory,string>={entrance:"Entrance",emphasis:"Emphasis",exit:"Exit"};

/**
 * Animation pane for a slide (J-09): the slide's animations in play order with
 * object, effect and timing; an add form (effect grouped by entrance, emphasis
 * and exit, start and duration in seconds) for the object selected on the
 * canvas; remove; and preview.
 */
export function SlideAnimationPane({scope='SlideAnimationPane',revision=0,...props}:SlideAnimationPaneProps){
 if(props.animations.length>4096||props.effects.length>256||new Set(props.animations.map(a=>a.index)).size!==props.animations.length||props.animations.some(a=>!Number.isSafeInteger(a.index)||a.index<0||!Number.isFinite(a.startS)||a.startS<0||a.startS>600||!Number.isFinite(a.durationS)||a.durationS<=0||a.durationS>600))throw new RangeError('Invalid slide animation schedule');
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=useEditorBoundary([JSON.stringify([identity,props.disabled,props.disabledReason,props.animations.map(a=>[a.index,a.objectId,a.kind])])]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <SlideAnimationPaneBody key={identity} {...props} boundary={owner} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onTimingCommit={props.onTimingCommit?(...args)=>guard.run('timing',h=>{if(!h.animations.some(a=>a.index===args[0])||![args[1].startS,args[1].durationS].every(Number.isFinite)||args[1].startS<0||args[1].startS>600||args[1].durationS<=0||args[1].durationS>600||!(h.supportedTriggers??['on-click']).includes(args[1].trigger))throw new Error('Animation timing or trigger unavailable');return h.onTimingCommit?.(...args);}):undefined}
  onOrderCommit={props.onOrderCommit?indices=>guard.run('order',h=>{if(indices.length!==h.animations.length||new Set(indices).size!==indices.length||indices.some(index=>!h.animations.some(a=>a.index===index)))throw new Error('Animation order no longer matches this slide');return h.onOrderCommit?.(indices);}):undefined}
  onAdd={props.onAdd?async(...args:Parameters<NonNullable<SlideAnimationPaneProps['onAdd']>>)=>{const ok=await guard.run('onAdd',h=>{if(args[0].objectId!==h.selectedObjectId||!h.effects.some(e=>e.kind===args[0].kind))throw new Error('Select an object and an available animation effect');return h.onAdd?.(...args);});if(ok!==true)throw new Error('Animation change did not complete');}:undefined}
  onRemove={props.onRemove?(...args:Parameters<NonNullable<SlideAnimationPaneProps['onRemove']>>)=>guard.run('onRemove',h=>h.animations.some(a=>a.index===args[0])?h.onRemove?.(...args):undefined):undefined}
  onPreview={props.onPreview?(...args:Parameters<NonNullable<SlideAnimationPaneProps['onPreview']>>)=>{guard.current()?.onPreview?.(...args);}:undefined}
 />;
}
function SlideAnimationPaneBody({boundary,actionError,disabledReason,disabled=false,
  animations,effects,objectLabel,selectedObjectId,onAdd,onRemove,onPreview,onTimingCommit,onOrderCommit,supportedTriggers=['on-click'],className,unstyled=false,...rest
}:SlideAnimationPaneProps&{boundary:string;actionError?:string|null}){
  const styled=!unstyled;
  const [local,store]=useLocalStore<Local>(()=>({kind:undefined,start:"0",duration:"0.5",error:undefined,busy:false,activeIndex:null}));
  useLayoutEffect(()=>{store.set(s=>({...s,busy:false,activeIndex:animations.some(a=>a.index===s.activeIndex)?s.activeIndex:null}));},[boundary]);
  const ordered=onOrderCommit?[...animations].sort((a,b)=>(a.order??a.index)-(b.order??b.index)):playOrder(animations),active=animations.find(a=>a.index===local.activeIndex);
  const kind=local.kind??effects[0]?.kind;
  const muted=joinClasses(styled&&"text-text-muted text-sm");
  const text=joinClasses(styled&&"text-text");
  const field=joinClasses(styled&&"rounded-control border border-border bg-surface-sunken text-text px-3 focus:border-focus");
  const add=async()=>{
    if(disabled||local.busy||!onAdd||!selectedObjectId||!kind)return;
    const s=parseSeconds(local.start,{allowZero:true});
    const d=parseSeconds(local.duration,{allowZero:false});
    if("error" in s){store.set(x=>({...x,error:"Start: "+s.error}));return;}
    if("error" in d){store.set(x=>({...x,error:"Duration: "+d.error}));return;}
    store.set(x=>({...x,busy:true,error:undefined}));
    try{await onAdd({objectId:selectedObjectId,kind,startS:s.value,durationS:d.value});store.set(x=>({...x,busy:false}));}
    catch(e){store.set(x=>({...x,busy:false,error:e instanceof Error?e.message:"The animation was not added."}));}
  };
  return <View {...rest} accessibilityLabel="Animations" {...{role:"region",className:joinClasses("min-w-0",className)}}
    style={[{gap:tokens.spacing.fixedInset},rest.style as object]}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:tokens.spacing.fixedElement}}>
      <Text {...{className:muted}} style={{fontVariant:["tabular-nums"]}}>
        {ordered.length===0?"No animations on this slide":(ordered.length===1?"1 animation":ordered.length+" animations")+", "+formatSeconds(timelineEnd(ordered))}
      </Text>
      {onPreview&&ordered.length?<Button disabled={disabled} title="Preview" variant="secondary" size="sm" onPress={onPreview}/>:null}
    </View>
    {ordered.length?<ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:tokens.spacing.off2}}>
      {ordered.map((a,i)=>{
        const name=objectLabel(a.objectId);
        const on=a.objectId===selectedObjectId;
        return <View key={a.index} {...{className:joinClasses(styled&&"rounded-control",styled&&on&&"bg-accent/10")}}
          style={{flexDirection:"row",alignItems:"center",gap:tokens.spacing.fixedElement,minHeight:OFFICE_TOUCH_TARGET,paddingStart:8}}>
          <Text {...{className:muted}} style={{width:tokens.spacing.off22,fontVariant:["tabular-nums"]}}>{i+1}</Text>
          <Pressable disabled={disabled} onPress={()=>store.set(s=>({...s,activeIndex:a.index}))} accessible accessibilityRole="button" accessibilityLabel={(i+1)+". "+name+", "+effectLabel(a.kind,effects)+", starts at "+formatSeconds(a.startS)+", lasts "+formatSeconds(a.durationS)}
            style={{flex:1,minWidth:0}}>
            <Text numberOfLines={1} {...{className:text}} style={{fontWeight:tokens.fontWeight.semibold}}>{name}</Text>
            <Text numberOfLines={1} {...{className:muted}}>{effectLabel(a.kind,effects)+", "+formatSeconds(a.startS)+" for "+formatSeconds(a.durationS)}</Text>
          </Pressable>
          {onOrderCommit?<Button title="Earlier in animation order" disabled={disabled||i===0} variant="secondary" unstyled={unstyled} onPress={()=>{const ids=ordered.map(a=>a.index);[ids[i-1],ids[i]]=[ids[i]!,ids[i-1]!];void onOrderCommit(ids);}}/>:null}
          {onRemove?<Pressable accessibilityRole="button" accessibilityLabel={"Remove "+effectLabel(a.kind,effects)+" on "+name}
            disabled={disabled} onPress={()=>void onRemove(a.index)}
            {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
            style={{width:OFFICE_TOUCH_TARGET,height:OFFICE_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
            <CloseMark styled={styled}/>
          </Pressable>:null}
        </View>;
      })}
    </ScrollView>:null}
    {active&&onTimingCommit?<PropertyInspector scope={boundary+':'+active.index} label="Animation timing and trigger" unstyled={unstyled} disabledReason={disabled?'Animation editing unavailable':undefined} fields={[
     {kind:'number',id:'startS',label:'Start time',value:active.startS,min:0,max:600,step:.01,unit:'s'},
     {kind:'number',id:'durationS',label:'Duration',value:active.durationS,min:.001,max:600,step:.01,unit:'s'},
     {kind:'choice',id:'trigger',label:'Start trigger',value:active.trigger??'on-click',choices:['on-click','with-previous','after-previous'].map(id=>({id,label:id,disabled:!supportedTriggers.includes(id as 'on-click'|'with-previous'|'after-previous')}))}
    ]} onCommit={(id,value)=>onTimingCommit(active.index,{startS:active.startS,durationS:active.durationS,trigger:active.trigger??'on-click',[id]:value})}/>:null}
    {onAdd&&effects.length?<View {...{className:joinClasses(styled&&"rounded-card border border-border bg-surface-raised")}} style={{padding:tokens.spacing.off10,gap:tokens.spacing.off10}}>
      <Text accessibilityRole="header" {...{className:text}} style={{fontWeight:tokens.fontWeight.semibold}}>
        {selectedObjectId?"Add animation to "+objectLabel(selectedObjectId):"Select an object on the slide to animate it"}
      </Text>
      {(["entrance","emphasis","exit"] as const).map(cat=>{
        const list=effects.filter(e=>e.category===cat);
        if(!list.length)return null;
        return <View key={cat} accessibilityLabel={CATEGORY_LABEL[cat]+" effects"} {...{role:"radiogroup"}} style={{gap:tokens.spacing.fixedStack}}>
          <Text {...{className:muted}}>{CATEGORY_LABEL[cat]}</Text>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.fixedStack}}>
            {list.map(e=><Pressable key={e.kind} accessibilityRole="radio" accessibilityState={{checked:kind===e.kind,disabled:!selectedObjectId}}
              disabled={!selectedObjectId} onPress={()=>store.set(x=>({...x,kind:e.kind}))}
              {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
                styled&&(kind===e.kind?"border-accent bg-accent/10":"border-border"))}}
              style={{minHeight:OFFICE_TOUCH_TARGET,paddingHorizontal:tokens.spacing.fixedInset,justifyContent:"center",opacity:selectedObjectId?1:tokens.opacity.disabled}}>
              <Text {...{className:joinClasses(styled&&"text-text text-sm")}}>{e.label}</Text>
            </Pressable>)}
          </View>
        </View>;
      })}
      <View style={{flexDirection:"row",gap:tokens.spacing.fixedElement,flexWrap:"wrap",alignItems:"flex-end"}}>
        <View style={{gap:tokens.spacing.fixedStack,flexGrow:1,flexBasis:tokens.spacing.off96}}>
          <Text {...{className:muted}}>Start (seconds)</Text>
          <TextInput value={local.start} onChangeText={v=>store.set(x=>({...x,start:v,error:undefined}))} inputMode="decimal"
            accessibilityLabel="Start, in seconds" maxLength={64} editable={!disabled&&!!selectedObjectId} {...{className:field}} style={{minHeight:OFFICE_TOUCH_TARGET}}/>
        </View>
        <View style={{gap:tokens.spacing.fixedStack,flexGrow:1,flexBasis:tokens.spacing.off96}}>
          <Text {...{className:muted}}>Duration (seconds)</Text>
          <TextInput value={local.duration} onChangeText={v=>store.set(x=>({...x,duration:v,error:undefined}))} inputMode="decimal"
            accessibilityLabel="Duration, in seconds" maxLength={64} editable={!disabled&&!!selectedObjectId} {...{className:field}} style={{minHeight:OFFICE_TOUCH_TARGET}}/>
        </View>
        <Button title="Add animation" loading={local.busy} disabled={disabled||local.busy||!selectedObjectId||!kind} onPress={()=>void add()}/>
      </View>
      {local.error?<Text accessibilityLiveRegion="assertive" {...{className:joinClasses(styled&&"text-danger text-sm")}}>{local.error}</Text>:null}
    </View>:null}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
