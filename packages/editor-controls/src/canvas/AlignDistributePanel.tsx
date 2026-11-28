import {forgeHairlineRadius} from "../radius.ts";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import type {ReactNode} from "react";
import {Pressable,Text,View,type ViewProps} from "react-native";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {announce} from "@nyc-tron/ui/components/feedback/announce";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {SettingSwitch} from "@nyc-tron/ui/components/forms/SettingSwitch";
import {
  ALIGN_EDGES,ARRANGE_ACTIONS,DISTRIBUTE_MAX_SPACING,alignAvailability,arrangeAvailability,arrangeTarget,planAlign,
  planDistribute,distributeAvailability,validateAlignItems,
  type AlignCommand,type AlignEdge,type AlignItem,type AlignReferenceKind,type ArrangeAction,type Availability,
  type DistributeAxis,type DistributeCommand,type DistributeMode,type MoveLayerCommand,type StackPosition,
} from "./align-distribute-model.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** Props for {@linkcode AlignDistributePanel}. Every value is owned by the host. */
export interface AlignDistributePanelProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** Selected layers, in selection order. */
  readonly items:readonly AlignItem[];
  /** What align buttons align against. */
  readonly reference:AlignReferenceKind;
  readonly onReferenceChange:(reference:AlignReferenceKind)=>void;
  /** The artboard "Artboard" aligns to, usually the one holding the selection. Omit when there is none. */
  readonly artboard?:{readonly id:string;readonly name:string};
  /** One `alignLayers` payload per press. */
  readonly onAlign:(command:AlignCommand,signal?:AbortSignal)=>void|Promise<unknown>;
  readonly distributeMode:DistributeMode;
  readonly onDistributeModeChange:(mode:DistributeMode)=>void;
  /** Fixed gap in document pixels for spacing mode; `undefined` spreads layers evenly between the outer two. */
  readonly spacing:number|undefined;
  readonly onSpacingChange:(spacing:number|undefined)=>void;
  /** One `distributeLayers` payload per press. */
  readonly onDistribute:(command:DistributeCommand,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Where the single selected layer sits among its siblings (0 = bottom). Omit to leave arrange unavailable. */
  readonly stack?:StackPosition;
  /** One `moveLayer` payload per press. */
  readonly onMoveLayer:(command:MoveLayerCommand,signal?:AbortSignal)=>void|Promise<unknown>;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Align, distribute and arrange panel (B-25). Align left, centre, right, top,
 * middle or bottom against the selection, the canvas or an artboard;
 * distribute three or more layers by centres or by gaps, optionally with a
 * fixed gap; and move one layer forward, backward, to the front or to the
 * back. When a group cannot act, its buttons stay focusable, read as
 * unavailable, and the reason is shown under them and spoken on press. Each
 * press emits one payload shaped like the Prism op.
 */
export function AlignDistributePanel({scope='align-distribute',revision=0,...props}:AlignDistributePanelProps){
 validateAlignItems(props.items);
 if(!['selection','canvas','artboard'].includes(props.reference)||!['centers','spacing'].includes(props.distributeMode)||props.spacing!==undefined&&(!Number.isFinite(props.spacing)||props.spacing<0||props.spacing>DISTRIBUTE_MAX_SPACING))throw new RangeError('Invalid distribution settings');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.disabled,props.items,props.artboard,props.stack]);
 const guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <AlignDistributePanelBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onReferenceChange={v=>guard.current()?.onReferenceChange(v)} onDistributeModeChange={v=>guard.current()?.onDistributeModeChange(v)} onSpacingChange={v=>guard.current()?.onSpacingChange(v)}
  onAlign={value=>guard.run('align',(host,signal)=>host.onAlign(value,signal))}
  onDistribute={value=>guard.run('distribute',(host,signal)=>host.onDistribute(value,signal))}
  onMoveLayer={value=>guard.run('arrange',(host,signal)=>host.onMoveLayer(value,signal))}/>;
}
function AlignDistributePanelBody({
  actionError=null,disabledReason,items,reference,onReferenceChange,artboard,onAlign,distributeMode,onDistributeModeChange,spacing,onSpacingChange,
  onDistribute,stack,onMoveLayer,disabled=false,className,unstyled=false,...rest
}:AlignDistributePanelProps&{actionError?:string|null}){
  validateAlignItems(items);
  const styled=!unstyled;
  const off=(reason:string):Availability=>({enabled:false,reason});
  const gate=(a:Availability)=>disabled?off(disabledReason??"Editing is paused"):a;
  const align=gate(alignAvailability(items,reference,artboard!==undefined));
  const distribute=gate(distributeAvailability(items));
  const arrange=gate(arrangeAvailability(items,stack));
  const heading=(text:string)=><Text role="heading" aria-level={3}
    {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{text}</Text>;
  const reasonLine=(a:Availability)=>a.enabled?null:<Text accessibilityLiveRegion="polite"
    {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{a.reason}</Text>;
  const press=(a:Availability|{reason:string}|{enabled:true},run:()=>void)=>()=>{
    if("reason" in a){announce(a.reason);return;}
    run();
  };
  const arrangeState=(action:ArrangeAction):Availability=>{
    if(!arrange.enabled||!stack)return arrange;
    const t=arrangeTarget(stack,action);
    return "reason" in t?off(t.reason):{enabled:true};
  };
  return <View {...rest} accessibilityLabel="Align and arrange"
    {...{role:"group",className:joinClasses(styled&&"gap-4",className)}}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <View style={{gap:tokens.spacing.fixedElement}}>
      {heading("Align")}
      <SegmentedControl aria-label="Align relative to" value={reference} onChange={onReferenceChange} disabled={disabled} unstyled={unstyled}
        options={[{value:"selection",label:"Selection"},{value:"canvas",label:"Canvas"},
          {value:"artboard",label:"Artboard",disabled:artboard===undefined}]}/>
      {reference==="artboard"&&artboard?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>Aligns to {artboard.name}</Text>:null}
      <View accessibilityLabel="Align" {...{role:"toolbar"}} style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.off6}}>
        {ALIGN_EDGES.map(({edge,label})=><ToolButton key={edge} label={label} available={align.enabled} styled={styled}
          onPress={press(align,()=>onAlign(planAlign(items,edge,reference,artboard?.id)))}>
          <Glyph shapes={ALIGN_GLYPHS[edge]} styled={styled}/>
        </ToolButton>)}
      </View>
      {reasonLine(align)}
    </View>
    <View style={{gap:tokens.spacing.fixedElement}}>
      {heading("Distribute")}
      <SegmentedControl aria-label="Distribute by" value={distributeMode} onChange={onDistributeModeChange} disabled={disabled} unstyled={unstyled}
        options={[{value:"centers",label:"Centers"},{value:"spacing",label:"Gaps"}]}/>
      {distributeMode==="spacing"?<>
        <SettingSwitch label="Fixed gap" on={spacing!==undefined} disabled={disabled} styled={styled}
          onChange={on=>onSpacingChange(on?0:undefined)}
          hint={spacing===undefined?"Off: gaps are made equal between the outermost layers":undefined}/>
        {spacing!==undefined?<PrecisionScrubber label="Gap" unit="px" value={spacing} min={0} max={DISTRIBUTE_MAX_SPACING} step={1}
          detents={[0,8,16,24,32]} disabled={disabled} unstyled={unstyled} onCommit={v=>onSpacingChange(Math.round(v))}/>:null}
      </>:null}
      <View accessibilityLabel="Distribute" {...{role:"toolbar"}} style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.off6}}>
        {(["horizontal","vertical"] as const satisfies readonly DistributeAxis[]).map(axis=><ToolButton key={axis}
          label={axis==="horizontal"?"Distribute horizontally":"Distribute vertically"}
          text={axis==="horizontal"?"Horizontally":"Vertically"} available={distribute.enabled} styled={styled}
          onPress={press(distribute,()=>onDistribute(planDistribute(items,axis,distributeMode,distributeMode==="spacing"?spacing:undefined)))}>
          <Glyph shapes={DISTRIBUTE_GLYPHS[axis]} styled={styled}/>
        </ToolButton>)}
      </View>
      {reasonLine(distribute)}
    </View>
    <View style={{gap:tokens.spacing.fixedElement}}>
      {heading("Arrange")}
      <View accessibilityLabel="Arrange" {...{role:"toolbar"}} style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.off6}}>
        {ARRANGE_ACTIONS.map(({action,label})=>{
          const a=arrangeState(action);
          return <ToolButton key={action} label={label} text={ARRANGE_SHORT[action]} available={a.enabled} styled={styled}
            hint={a.enabled?undefined:a.reason}
            onPress={press(a,()=>{const t=stack&&arrangeTarget(stack,action);if(t&&"to_index" in t)onMoveLayer({id:items[0]!.id,to_index:t.to_index});})}>
            <Glyph shapes={ARRANGE_GLYPHS[action]} styled={styled}/>
          </ToolButton>;
        })}
      </View>
      {arrange.enabled&&stack?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{fontVariant:["tabular-nums"]}}>
        {stack.index===stack.count-1?"At the front":stack.index===0?"At the back":`${stack.count-stack.index} of ${stack.count} from the front`}</Text>
        :reasonLine(arrange)}
    </View>
  </View>;
}

const ARRANGE_SHORT:Record<ArrangeAction,string>={front:"To front",forward:"Forward",backward:"Backward",back:"To back"};

function ToolButton({label,text,hint,available,onPress,styled,children}:{
  label:string;text?:string;hint?:string|undefined;available:boolean;onPress:()=>void;styled:boolean;children:ReactNode;
}){
  // Unavailable buttons stay pressable so they can say why (the InkToolbar
  // pattern); React Native Web's `disabled` would swallow the press.
  return <Pressable role="button" aria-label={available?label:label+", unavailable"} accessibilityHint={hint}
    accessibilityState={{disabled:!available}} onPress={onPress}
    {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus")}}
    style={{minWidth:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedTarget,paddingHorizontal:text?tokens.spacing.off10:0,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:tokens.spacing.off6,
      opacity:available?1:tokens.opacity.disabled,...(text?{flexGrow:1}:null)}}>
    {children}
    {text?<Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-xs font-medium")}}>{text}</Text>:null}
  </Pressable>;
}

/** A glyph part in a 20×20 box: a filled bar (`fill`) or an outlined box. */
type Shape=readonly [x:number,y:number,w:number,h:number,fill:boolean];
const ALIGN_GLYPHS:Record<AlignEdge,readonly Shape[]>={
  left:[[1,0,2,20,true],[5,3,13,5,false],[5,12,8,5,false]],
  hcenter:[[9,0,2,20,true],[2,3,16,5,false],[5,12,10,5,false]],
  right:[[17,0,2,20,true],[2,3,13,5,false],[7,12,8,5,false]],
  top:[[0,1,20,2,true],[3,5,5,13,false],[12,5,5,8,false]],
  vcenter:[[0,9,20,2,true],[3,2,5,16,false],[12,5,5,10,false]],
  bottom:[[0,17,20,2,true],[3,2,5,13,false],[12,7,5,8,false]],
};
const DISTRIBUTE_GLYPHS:Record<DistributeAxis,readonly Shape[]>={
  horizontal:[[0,0,2,20,true],[18,0,2,20,true],[4,5,4,10,false],[12,5,4,10,false]],
  vertical:[[0,0,20,2,true],[0,18,20,2,true],[5,4,10,4,false],[5,12,10,4,false]],
};
const ARRANGE_GLYPHS:Record<ArrangeAction,readonly Shape[]>={
  front:[[1,5,11,11,false],[8,1,11,11,true],[0,19,20,1,true]],
  forward:[[1,8,11,11,false],[8,1,11,11,true]],
  backward:[[8,1,11,11,true],[1,8,11,11,false]],
  back:[[8,4,11,11,true],[1,8,11,11,false],[0,0,20,1,true]],
};
function Glyph({shapes,styled}:{shapes:readonly Shape[];styled:boolean}){
  return <View pointerEvents="none" style={{width:tokens.spacing.off20,height:tokens.spacing.off20}}>
    {shapes.map(([x,y,w,h,fill],i)=><View key={i}
      {...{className:joinClasses(styled&&(fill?"bg-text":"border-2 border-text-muted bg-surface-raised"))}}
      style={{position:"absolute",left:x,top:y,width:w,height:h,borderRadius:fill?0:forgeHairlineRadius.tick}}/>)}
  </View>;
}
