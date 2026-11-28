import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEffect,useRef} from "react";
import {Pressable,Text,TextInput,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {
  DASH_OFFSET_RANGE,DASH_PRESETS,FILL_TYPES,MITER_RANGE,STROKE_WIDTH_RANGE,
  convertPaint,dashForPreset,defaultStroke,fillTypeOf,formatDash,miterAvailability,paintSupport,parseDash,presetForDash,
  primaryColor,withPaintColor,
  type ContentBounds,type DashPreset,type FillType,type PaintableKind,
} from "./fill-stroke-model.ts";
import {
  availabilityReason,describeRgba,rgbaToCss,validatePaint,validateStroke,
  type FillRule,type LineCap,type LineJoin,type Paint,type PaintOrder,type Rgba,type Stroke,
} from "./vector-types.ts";
import {GroupLabel,NoticeLine,VECTOR_TOUCH_TARGET,VectorButton} from "./vector-controls.tsx";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** A color the host offers as a swatch. */
export interface PaintSwatch {
  readonly id:string;
  readonly label:string;
  readonly color:Rgba;
}

/** Props for {@linkcode FillStrokeInspector}. Every value is the selected layer's, owned by the host. */
export interface FillStrokeInspectorProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The layer's content kind; shapes take a solid fill only and booleans a fill only. */
  kind:PaintableKind;
  fill:Paint|null;
  stroke:Stroke|null;
  fillRule:FillRule;
  paintOrder:PaintOrder;
  /** Layer content bounds; new gradients span them. */
  bounds:ContentBounds;
  /** Colors offered for the fill and the stroke. */
  swatches:readonly PaintSwatch[];
  /** The gradient stop a fill swatch recolors (shared with the on-canvas handles). @default 0 */
  selectedStop?:number;
  /** Maps to `setFill {id, fill}`. */
  onSetFill:(fill:Paint|null,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Maps to `setStroke {id, stroke}`. One call per release, key press or submitted field. */
  onSetStroke:(stroke:Stroke|null,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Stroke to draw while a value is being scrubbed; `undefined` when the scrub ends. */
  onPreviewStroke?:(stroke:Stroke|undefined)=>void;
  /** Maps to `setFillRule {id, rule}`. */
  onSetFillRule:(rule:FillRule,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Maps to `setPaintOrder {id, order}`. */
  onSetPaintOrder:(order:PaintOrder,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Opens the host's color picker for a color outside the swatches. The button shows only when this is passed. */
  onRequestColor?:(target:"fill"|"stroke")=>void;
  className?:string;
  unstyled?:boolean;
}
type Local={notice:string|undefined;dashDraft:string|undefined;dashError:string|undefined};

const JOINS=[{value:"miter",label:"Miter"},{value:"round",label:"Round"},{value:"bevel",label:"Bevel"}] as const;
const CAPS=[{value:"butt",label:"Butt"},{value:"round",label:"Round"},{value:"square",label:"Square"}] as const;
const RULES=[{value:"nonzero",label:"Non-zero"},{value:"evenodd",label:"Even-odd"}] as const;
const ORDERS=[{value:"fill-stroke",label:"Stroke on top"},{value:"stroke-fill",label:"Fill on top"}] as const;
const sameColor=(a:Rgba,b:Rgba)=>a.every((v,i)=>v===b[i]);

/**
 * Fill and stroke inspector for one vector layer (B-23): fill type and color,
 * fill rule, stroke on or off, width, join, cap, miter limit, dash pattern
 * (presets that scale with the width, or a typed custom pattern), dash
 * offset and paint order. Controls a layer kind cannot use stay visible,
 * disabled, with the reason under them.
 */
export function FillStrokeInspector({scope='fill-stroke',revision=0,...props}:FillStrokeInspectorProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.kind,props.bounds]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <FillStrokeInspectorBody key={owner} {...props} actionError={guard.error} busy={guard.pending}
  onSetFill={value=>guard.run('onSetFill',(host,signal)=>host.onSetFill(value,signal))}
  onSetStroke={value=>guard.run('onSetStroke',(host,signal)=>host.onSetStroke(value,signal))}
  onSetFillRule={value=>guard.run('onSetFillRule',(host,signal)=>host.onSetFillRule(value,signal))}
  onSetPaintOrder={value=>guard.run('onSetPaintOrder',(host,signal)=>host.onSetPaintOrder(value,signal))}
  {...(props.onRequestColor?{onRequestColor:(target:Parameters<NonNullable<FillStrokeInspectorProps['onRequestColor']>>[0])=>guard.current()?.onRequestColor?.(target)}:{})}
  {...(props.onPreviewStroke?{onPreviewStroke:(value:Parameters<NonNullable<FillStrokeInspectorProps['onPreviewStroke']>>[0])=>guard.current()?.onPreviewStroke?.(value)}:{})}/>;
}
function FillStrokeInspectorBody({
  actionError=null,busy=false,disabledReason,
  kind,fill,stroke,fillRule,paintOrder,bounds,swatches,selectedStop=0,onSetFill,onSetStroke,onPreviewStroke,
  onSetFillRule,onSetPaintOrder,onRequestColor,className,unstyled=false,style,...rest
}:FillStrokeInspectorProps&{actionError?:string|null;busy?:boolean}){
  if(fill)validatePaint(fill);
  if(stroke)validateStroke(stroke);
  const support=paintSupport(kind);
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({notice:undefined,dashDraft:undefined,dashError:undefined}));
  const store=local.current;
  const {notice,dashDraft,dashError}=useStore(store,s=>s);
  const strokeKey=stroke?formatDash(stroke.dash):"";
  // A new committed pattern replaces whatever was being typed.
  useEffect(()=>{store.setState({dashDraft:undefined,dashError:undefined});},[strokeKey,store]);
  const styled=!unstyled;
  const fallback:Rgba=swatches[0]?.color??[0,0,0,255];
  const muted=joinClasses(styled&&"text-text-muted text-xs");
  const gradientReason=disabledReason??(busy?"Applying change":availabilityReason(support.gradientFill));
  const strokeReason=disabledReason??(busy?"Applying change":availabilityReason(support.stroke));
  const fillType=fillTypeOf(fill);
  const stop=fill&&fill.type!=="solid"?Math.min(selectedStop,fill.stops.length-1):0;
  const fillColor=fill?(fill.type==="solid"?fill.color:fill.stops[stop]!.color):undefined;
  const setFillType=(type:FillType)=>{
    if(type===fillType)return;
    onSetFill(convertPaint(fill,type,bounds,fallback));
  };
  const commitStroke=(next:Stroke)=>{
    if(stroke&&JSON.stringify(next)===JSON.stringify(stroke))return;
    validateStroke(next);
    onSetStroke(next);
  };
  const applyDashDraft=()=>{
    const draft=store.getState().dashDraft;
    if(draft===undefined||!stroke)return;
    const parsed=parseDash(draft);
    if(!parsed.ok){store.setState({dashError:parsed.error});return;}
    store.setState({dashError:undefined});
    commitStroke({...stroke,dash:parsed.dash});
  };
  const preset:DashPreset=stroke?presetForDash(stroke.dash,stroke.width):"solid";
  const miterReason=stroke?availabilityReason(miterAvailability(stroke)):undefined;
  const offsetReason=stroke&&stroke.dash.length===0?"Set a dash pattern to use an offset":undefined;

  return <View {...rest} {...{className:joinClasses("gap-4",styled&&"rounded-control border border-border bg-surface-raised p-3",className)}}
    style={[{minWidth:0},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Applying change"}</Text>:null}
    <View style={{gap:tokens.spacing.fixedElement}} testID="fill-section">
      <GroupLabel styled={styled}>Fill</GroupLabel>
      <SegmentedControl aria-label="Fill type" unstyled={unstyled} value={fillType}
        options={FILL_TYPES.map(o=>({...o,disabled:(o.value==="linear"||o.value==="radial")&&gradientReason!==undefined}))}
        onChange={setFillType}/>
      {gradientReason?<Text {...{className:muted}}>{gradientReason}</Text>:null}
      {fill&&fillColor?<SwatchRow label={fill.type==="solid"?"Fill color":`Stop ${stop+1} color`} swatches={swatches}
        current={fillColor} styled={styled}
        onPick={color=>onSetFill(withPaintColor(fill,color,stop))}
        onCustom={onRequestColor?()=>onRequestColor("fill"):undefined}/>:null}
      {fill&&fill.type!=="solid"?<Text {...{className:muted}}>
        {`${fill.stops.length} stops. Drag the handles on the canvas to place the gradient and its stops.`}</Text>:null}
      <SegmentedControl aria-label="Fill rule" unstyled={unstyled} value={fillRule} options={RULES}
        disabled={support.fillRule.enabled===false} onChange={rule=>{if(rule!==fillRule)onSetFillRule(rule);}}/>
      {availabilityReason(support.fillRule)&&!gradientReason?<Text {...{className:muted}}>{availabilityReason(support.fillRule)}</Text>:null}
    </View>

    <View style={{gap:tokens.spacing.fixedElement}} testID="stroke-section">
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:tokens.spacing.fixedElement,flexWrap:"wrap"}}>
        <GroupLabel styled={styled}>Stroke</GroupLabel>
        <VectorButton role="switch" label="Stroke" checked={stroke!==null} styled={styled} reason={strokeReason}
          onBlocked={reason=>store.setState({notice:reason})}
          onPress={()=>{store.setState({notice:undefined});onSetStroke(stroke?null:defaultStroke(fallback));}}/>
      </View>
      {strokeReason?<Text {...{className:muted}}>{strokeReason}</Text>:null}
      {stroke?<>
        <SwatchRow label="Stroke color" swatches={swatches} current={primaryColor(stroke.paint)} styled={styled}
          onPick={color=>commitStroke({...stroke,paint:withPaintColor(stroke.paint,color,0)})}
          onCustom={onRequestColor?()=>onRequestColor("stroke"):undefined}/>
        <PrecisionScrubber label="Width" unit="pt" value={stroke.width} {...STROKE_WIDTH_RANGE} unstyled={unstyled}
          onPreview={width=>onPreviewStroke?.(width===stroke.width?undefined:{...stroke,width})}
          onCommit={width=>{onPreviewStroke?.(undefined);commitStroke({...stroke,width});}}/>
        <Text {...{className:muted}}>Join</Text>
        <SegmentedControl aria-label="Join" unstyled={unstyled} value={stroke.join} options={JOINS}
          onChange={(join:LineJoin)=>commitStroke({...stroke,join})}/>
        <Text {...{className:muted}}>Cap</Text>
        <SegmentedControl aria-label="Cap" unstyled={unstyled} value={stroke.cap} options={CAPS}
          onChange={(cap:LineCap)=>commitStroke({...stroke,cap})}/>
        <PrecisionScrubber label="Miter limit" value={stroke.miter_limit} {...MITER_RANGE} unstyled={unstyled}
          disabled={miterReason!==undefined}
          onPreview={v=>onPreviewStroke?.(v===stroke.miter_limit?undefined:{...stroke,miter_limit:v})}
          onCommit={v=>{onPreviewStroke?.(undefined);commitStroke({...stroke,miter_limit:v});}}/>
        {miterReason?<Text {...{className:muted}}>{miterReason}</Text>:null}
        <Text {...{className:muted}}>Dash</Text>
        <SegmentedControl aria-label="Dash pattern" unstyled={unstyled} value={preset} options={DASH_PRESETS}
          onChange={(next:DashPreset)=>{
            if(next==="custom"){store.setState({dashDraft:formatDash(stroke.dash.length?stroke.dash:dashForPreset("dash",stroke.width))});return;}
            commitStroke({...stroke,dash:dashForPreset(next,stroke.width)});
          }}/>
        {preset==="custom"||dashDraft!==undefined?<View style={{gap:tokens.spacing.fixedStack}}>
          <TextInput accessibilityLabel="Custom dash pattern" placeholder="6 3"
            value={dashDraft??formatDash(stroke.dash)} returnKeyType="done"
            onChangeText={text=>store.setState({dashDraft:text,dashError:undefined})}
            onSubmitEditing={applyDashDraft} onBlur={applyDashDraft}
            {...{className:joinClasses(styled&&"rounded-control border bg-surface-sunken text-text",
              styled&&(dashError?"border-danger":"border-border"))}}
            style={{minHeight:VECTOR_TOUCH_TARGET,paddingHorizontal:tokens.spacing.off10,fontVariant:["tabular-nums"]}}/>
          <Text {...{className:dashError?joinClasses(styled&&"text-danger text-xs"):muted}}
            accessibilityLiveRegion={dashError?"assertive":"none"}>
            {dashError??"Dash and gap lengths in points, separated by spaces"}</Text>
        </View>:null}
        <PrecisionScrubber label="Dash offset" value={stroke.dash_offset} {...DASH_OFFSET_RANGE} unstyled={unstyled}
          disabled={offsetReason!==undefined}
          onPreview={v=>onPreviewStroke?.(v===stroke.dash_offset?undefined:{...stroke,dash_offset:v})}
          onCommit={v=>{onPreviewStroke?.(undefined);commitStroke({...stroke,dash_offset:v});}}/>
        {offsetReason?<Text {...{className:muted}}>{offsetReason}</Text>:null}
      </>:null}
      <Text {...{className:muted}}>Paint order</Text>
      <SegmentedControl aria-label="Paint order" unstyled={unstyled} value={paintOrder} options={ORDERS}
        disabled={support.paintOrder.enabled===false}
        onChange={order=>{if(order!==paintOrder)onSetPaintOrder(order);}}/>
    </View>
    <NoticeLine text={notice} styled={styled} testID="inspector-notice"/>
  </View>;
}

function SwatchRow({label,swatches,current,styled,onPick,onCustom}:{
  label:string;swatches:readonly PaintSwatch[];current:Rgba;styled:boolean;onPick:(color:Rgba)=>void;onCustom:(()=>void)|undefined;
}){
  const matched=swatches.find(s=>sameColor(s.color,current));
  return <View style={{gap:tokens.spacing.fixedStack}}>
    <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>
      {`${label}: ${matched?.label??describeRgba(current)}`}</Text>
    <View role="radiogroup" aria-label={label} style={{flexDirection:"row",flexWrap:"wrap",gap:tokens.spacing.off2}}>
      {swatches.map(s=>{
        const on=matched?.id===s.id;
        return <Pressable key={s.id} role="radio" aria-checked={on} aria-label={s.label}
          onPress={()=>{if(!on)onPick(s.color);}}
          {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus",
            styled&&"border-2",styled&&(on?"border-primary":"border-transparent"))}}
          style={{width:VECTOR_TOUCH_TARGET,height:VECTOR_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
          <View pointerEvents="none" {...{className:joinClasses(styled&&"border border-border")}}
            style={{width:tokens.spacing.fixedStatus,height:tokens.spacing.fixedStatus,borderRadius:tokens.spacing.fixedStatus / 2, /* radius-exempt: colour-well */backgroundColor:rgbaToCss(s.color)}}/>
        </Pressable>;
      })}
      {onCustom?<Pressable role="button" aria-label={"Custom "+label.toLowerCase()} onPress={onCustom}
        {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus")}}
        style={{minWidth:VECTOR_TOUCH_TARGET,height:VECTOR_TOUCH_TARGET,paddingHorizontal:tokens.spacing.off10,alignItems:"center",justifyContent:"center"}}>
        <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontSize:tokens.text.off13}}>Custom</Text>
      </Pressable>:null}
    </View>
  </View>;
}
