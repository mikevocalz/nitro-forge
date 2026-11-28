import {useEffect,useRef} from "react";
import {Modal,Pressable,ScrollView,Text,View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {assertHsv,hsvToRgb,rgbaToHex,type HsvColor} from "../color.ts";
import {createFrameThrottle,type FrameThrottle} from "../frame-throttle.ts";
import {AlphaSlider} from "./AlphaSlider.tsx";
import {ColorChannelFields} from "./ColorChannelFields.tsx";
import {HsvPicker} from "./HsvPicker.tsx";
import {SwatchGrid} from "./SwatchGrid.tsx";
import {swatchKey,type SwatchGroup} from "./swatches.ts";
import {checkerColumns} from "./segments.ts";
import type {ChannelModel} from "./channel-fields.ts";
import {
  colorChanged,colorDialogTitle,comparisonContrast,comparisonLabel,describeColor,dialogKeyIntent,
  draftFromRgba,draftWithAlpha,revertDraft,type DialogKeyTarget,
} from "./color-picker-dialog-model.ts";
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode ColorPickerDialog}. Every color is controlled by the host. */
export interface ColorPickerDialogProps {
  readonly visible:boolean;
  /** The color in the document when the dialog opened. Shown at the start edge of the comparison. */
  readonly original:HsvColor;
  /** The draft. Update it from `onValueChange`; it is shown at the end edge of the comparison. */
  readonly value:HsvColor;
  /** Every draft change: field drag, hue, opacity, typed channel, swatch or revert. */
  readonly onValueChange:(next:HsvColor)=>void;
  /**
   * Live preview for the canvas, at most once per animation frame. Never
   * write it to the document or the undo history. Cancel sends `original`
   * here before `onCancel`, so a preview never sticks. When absent, nothing
   * is scheduled.
   */
  readonly onPreview?:(color:HsvColor)=>void;
  /** Apply, or Enter on the dialog surface. Called once; commit one undo entry here. */
  readonly onCommit:(color:HsvColor)=>void;
  /** Cancel, Escape, Android back or a press on the backdrop. Close the dialog here. */
  readonly onCancel:()=>void;
  /** What the color is for, e.g. "Foreground" or "Shape fill". Shown in the title. */
  readonly target?:string;
  /** Replaces the title built from `target`. */
  readonly title?:string;
  /** Host swatch groups, e.g. one `recent` group. The swatch section is hidden when omitted or empty. */
  readonly swatchGroups?:readonly SwatchGroup[];
  /** Channel set for the typed fields. Without `onChannelModelChange` the dialog remembers the choice while open. */
  readonly channelModel?:ChannelModel;
  readonly onChannelModelChange?:(model:ChannelModel)=>void;
  /** Shows the opacity slider and field. @default true */
  readonly showAlpha?:boolean;
  /** Shows the WCAG contrast of the draft against the original. @default false */
  readonly showContrast?:boolean;
  /** @default "Apply color" */
  readonly applyLabel?:string;
  className?:string;
  unstyled?:boolean;
  testID?:string;
}

type Local={model:ChannelModel;query:string;width:number};
const CELL=8;
const SWATCH_HEIGHT=48;

function targetOf(event:unknown):DialogKeyTarget{
  const el=(event as {target?:{tagName?:string;closest?:(selector:string)=>unknown}}).target;
  const tag=el?.tagName?.toUpperCase();
  if(tag==="INPUT"||tag==="TEXTAREA")return "text-field";
  if(el?.closest?.('button,[role="button"],[role="radio"],[role="slider"],[role="tab"],[role="switch"],[role="adjustable"]'))return "control";
  return "surface";
}

/**
 * Color picker dialog (C-01). A comparison swatch shows the original at the
 * start edge and the draft at the end edge (mirrored in RTL); pressing the
 * original reverts the draft. The body composes `HsvPicker` (field and hue),
 * `AlphaSlider`, `ColorChannelFields` (RGB/HSL/HSV and hex entry) and an
 * optional `SwatchGrid` of host swatches. Nothing is written to the document
 * until Apply: drags and typing go to `onValueChange` and, throttled to one
 * per frame, `onPreview`.
 */
export function ColorPickerDialog({
  visible,original,value,onValueChange,onPreview,onCommit,onCancel,target,title,swatchGroups,
  channelModel,onChannelModelChange,showAlpha=true,showContrast=false,applyLabel="Apply color",
  className,unstyled=false,testID,
}:ColorPickerDialogProps){
  assertHsv(original);
  assertHsv(value);
  const styled=!unstyled;
  const stateRef=useRef<StoreApi<Local>|null>(null);
  if(!stateRef.current)stateRef.current=createStore<Local>(()=>({model:channelModel??"rgb",query:"",width:0}));
  const store=stateRef.current;
  const local=useStore(store,s=>s);
  const latest=useRef({onPreview,onCommit,onCancel,original,value});
  latest.current={onPreview,onCommit,onCancel,original,value};
  const throttle=useRef<FrameThrottle<HsvColor>|null>(null);
  if(!throttle.current)throttle.current=createFrameThrottle<HsvColor>(c=>latest.current.onPreview?.(c));
  // One close per opening: Escape's keyup and a backdrop press must not both cancel.
  const closed=useRef(false);
  useEffect(()=>{if(visible)closed.current=false;else throttle.current?.cancel();},[visible]);
  useEffect(()=>()=>throttle.current?.cancel(),[]);

  const change=(next:HsvColor)=>{
    onValueChange(next);
    if(latest.current.onPreview)throttle.current!.push(next);
  };
  const commit=()=>{
    if(closed.current)return;
    closed.current=true;
    throttle.current!.cancel();
    latest.current.onCommit(latest.current.value);
  };
  const cancel=()=>{
    if(closed.current)return;
    closed.current=true;
    throttle.current!.cancel();
    latest.current.onPreview?.(latest.current.original);
    latest.current.onCancel();
  };
  const onKeyDown=(event:KeyEventLike&{preventDefault?:()=>void})=>{
    const intent=dialogKeyIntent(keyboardKey(event),targetOf(event));
    // Escape is left to the Modal's onRequestClose, which fires on its keyup.
    if(intent!=="commit")return;
    event.preventDefault?.();
    commit();
  };

  const model=channelModel??local.model;
  const changed=colorChanged(original,value);
  const heading=title??colorDialogTitle(target);
  const groups=swatchGroups?.filter(g=>g.swatches.length>0)??[];
  const rgb=hsvToRgb(value);
  const contrast=showContrast?comparisonContrast(value,original):undefined;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const muted=joinClasses(styled&&"text-text-muted text-sm");
  const columns=checkerColumns(local.width/2,CELL);
  const half=(side:"original"|"new",color:HsvColor)=>{
    const fill=<>
      {columns?<View pointerEvents="none" style={{position:"absolute",left:0,top:0,bottom:0,flexDirection:"row"}}>
        {Array.from({length:columns},(_,i)=><View key={i} style={{width:CELL}}>
          {Array.from({length:SWATCH_HEIGHT/CELL},(_,j)=><View key={j}
            {...{className:joinClasses(styled&&((i+j)%2?"bg-border":"bg-surface-raised"))}} style={{height:CELL}}/>)}
        </View>)}
      </View>:null}
      <View pointerEvents="none" style={{position:"absolute",left:0,right:0,top:0,bottom:0,backgroundColor:rgbaToHex(hsvToRgb(color))}}/>
    </>;
    const caption=<View style={{flexDirection:"row",justifyContent:"space-between",gap:tokens.spacing.off6,paddingTop:tokens.spacing.off6}}>
      <Text {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{side==="original"?"Original":"New"}</Text>
      <Text {...{className:muted}} style={{fontVariant:["tabular-nums"]}}>{rgbaToHex(hsvToRgb(color),color.alpha<1)}</Text>
    </View>;
    if(side==="new")return <View style={{flex:1}} accessible accessibilityLabel={comparisonLabel("new",color,changed)} {...id("new")}>
      <View style={{height:SWATCH_HEIGHT,overflow:"hidden"}} {...{className:joinClasses(styled&&"rounded-control border border-border")}}>{fill}</View>
      {caption}
    </View>;
    return <Pressable style={{flex:1}} accessibilityRole="button" accessibilityLabel={comparisonLabel("original",color,changed)}
      accessibilityHint={changed?"Sets the new color back to the original":undefined}
      accessibilityState={{disabled:!changed}} disabled={!changed} onPress={()=>change(revertDraft(original))}
      {...id("original")}
      {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}>
      <View style={{height:SWATCH_HEIGHT,overflow:"hidden"}} {...{className:joinClasses(styled&&"rounded-control border border-border")}}>{fill}</View>
      {caption}
    </Pressable>;
  };

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel} statusBarTranslucent>
    <View style={{flex:1,alignItems:"center",justifyContent:"center",padding:tokens.spacing.fixedGroup}}>
      {/* The backdrop is a mouse and touch target only; Cancel and Escape are the accessible ways out. */}
      <Pressable accessible={false} importantForAccessibility="no" aria-hidden onPress={cancel} {...id("backdrop")}
        {...{className:styled?"bg-text/50":undefined}} style={{position:"absolute",left:0,right:0,top:0,bottom:0}}/>
      <View accessibilityViewIsModal role="dialog" aria-label={heading} aria-modal
        {...(testID?{testID}:{})}
        {...{onKeyDown,className:joinClasses("w-full",styled&&"rounded-control border border-border bg-surface-raised",className)}}
        style={{maxWidth:tokens.spacing.off480,maxHeight:"92%"}}>
        <Text accessibilityRole="header" {...{className:joinClasses("text-start",styled&&"text-lg font-semibold text-text")}}
          style={{paddingHorizontal:tokens.spacing.fixedGroup,paddingTop:tokens.spacing.fixedGroup,paddingBottom:tokens.spacing.fixedInset}}>{heading}</Text>
        <ScrollView contentContainerStyle={{paddingHorizontal:tokens.spacing.fixedGroup,paddingBottom:tokens.spacing.fixedGroup,gap:tokens.spacing.fixedGroup}} keyboardShouldPersistTaps="handled">
          <View style={{gap:tokens.spacing.off6}}>
            <View style={{flexDirection:"row",gap:tokens.spacing.fixedElement}} onLayout={e=>store.setState(s=>({...s,width:e.nativeEvent.layout.width}))}>
              {half("original",original)}
              {half("new",value)}
            </View>
            {contrast?<Text {...{className:muted}} {...id("contrast")}>{contrast.text}</Text>:null}
          </View>
          <HsvPicker value={value} onValueChange={change} fieldHeight={160} showChannels={false} showHexReadout={false}
            unstyled={unstyled} {...id("picker")}/>
          {showAlpha?<AlphaSlider value={rgb} unstyled={unstyled}
            onPreview={next=>change(draftWithAlpha(value,next.alpha))}
            onCommit={next=>change(draftWithAlpha(value,next.alpha))} {...id("alpha")}/>:null}
          <ColorChannelFields value={value} onCommit={change} model={model} showAlpha={showAlpha} unstyled={unstyled}
            onModelChange={m=>{store.setState(s=>({...s,model:m}));onChannelModelChange?.(m);}}
            {...id("fields")}/>
          {groups.length?<SwatchGrid groups={groups} query={local.query} onQueryChange={q=>store.setState(s=>({...s,query:q}))}
            selectedKey={swatchKey({id:"",color:rgb})} unstyled={unstyled}
            onSelect={swatch=>change(draftFromRgba(swatch.color,value))} {...id("swatches")}/>:null}
        </ScrollView>
        <View {...{className:joinClasses(styled&&"border-t border-border")}}
          style={{flexDirection:"row",justifyContent:"flex-end",flexWrap:"wrap",gap:tokens.spacing.fixedElement,padding:tokens.spacing.fixedInset}}>
          <Text accessibilityLiveRegion="polite" {...{className:muted}} style={{flex:1,minWidth:controlTokens.extent.fieldWide,alignSelf:"center"}}>
            {changed?describeColor(value):"No change yet"}
          </Text>
          <Button title="Cancel" variant="secondary" onPress={cancel} {...id("cancel")}/>
          <Button title={applyLabel} onPress={commit} {...id("apply")}/>
        </View>
      </View>
    </View>
  </Modal>;
}
