import {useEffect,useLayoutEffect,useRef} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import type {LocalPoint} from "@nyc-tron/ui/components/gestures/local-pointer";
import {webKey} from "@nyc-tron/ui/components/forms/choice-keys";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import type {LocalStore} from "@nyc-tron/ui/components/local-store";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {forgeType} from "../type-scale.ts";
import {docToScreen,screenPointToDoc,tidy,validateViewport,type CanvasViewport,type DocPoint} from "./canvas-viewport.ts";
import {
  DEFAULT_DPI,RULER_THICKNESS,RULER_TOUCH_BAND,centerGuidePosition,formatLength,guideAccessibilityLabel,guideAxis,
  guideKeyCommand,guidePositionAt,isOverOwnRuler,rulerTicks,validateGuides,
  type CanvasGuide,type NewCanvasGuide,type RulerUnit,
} from "./ruler-model.ts";

/** A guide being dragged: a new one out of a ruler, or an existing one by `id`. */
export interface GuidePreview {
  /** Set when an existing guide is moving. */
  readonly id?:string;
  readonly orientation:CanvasGuide["orientation"];
  readonly position:number;
  /** True while the pointer is back over the guide's ruler: releasing removes it (or adds nothing). */
  readonly removing:boolean;
}
/** Props for {@linkcode CanvasRuler}. */
export interface CanvasRulerProps extends Omit<ViewProps,"children"> {
  readonly scope?:string;
  readonly revision?:string|number;
  readonly viewport:CanvasViewport;
  readonly unit:RulerUnit;
  /** Document resolution for in, cm, mm and pt. @default 72 */
  readonly dpi?:number;
  /** Document point where both rulers read zero. @default {x:0,y:0} */
  readonly origin?:DocPoint;
  /** The document's guides. The host stores them; this component only previews drags. */
  readonly guides:readonly CanvasGuide[];
  /** A drag out of a ruler, or Enter on a focused ruler, placed a guide. One call per release or key press. */
  readonly onAddGuide:(guide:NewCanvasGuide)=>void;
  /** A guide was dragged or nudged to a new whole-pixel position. One call per release or key press. */
  readonly onMoveGuide:(id:string,position:number)=>void;
  /** A guide was dropped back on its ruler, or Delete was pressed on it. */
  readonly onRemoveGuide:(id:string)=>void;
  /** Each move of a guide drag, then `undefined` when it ends or is cancelled. */
  readonly onGuidePreview?:(preview:GuidePreview|undefined)=>void;
  /** The corner was dragged to set a new zero point, or pressed to reset it. Omit to fix the origin. */
  readonly onOriginChange?:(origin:DocPoint)=>void;
  /** Document point under the host's pointer, marked on both rulers. */
  readonly pointer?:DocPoint;
  /** Visible ruler thickness; the touch band is always at least 44. @default 24 */
  readonly thickness?:number;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Drag=
  |{readonly kind:"guide";readonly id?:string;readonly orientation:CanvasGuide["orientation"];readonly at:LocalPoint;readonly start:number}
  |{readonly kind:"origin";readonly at:LocalPoint;readonly from:LocalPoint};
type Local={drag:Drag|undefined;focused:string|undefined};

// Web only: a drag otherwise selects ruler labels, and touch would scroll. Not ViewStyle keys in RN.
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none",touchAction:"none"}:{}) as object;
const stopKey=(k:{preventDefault:()=>void})=>k.preventDefault();

/**
 * Canvas rulers and guides (B-03): a top ruler counting x and a side ruler
 * counting y in px, in, cm, mm or pt, with ticks that re-space as you zoom
 * and labels counted from a movable origin. Drag out of a ruler to place a
 * guide, drag a guide to move it, drop it back on its ruler to remove it;
 * Escape cancels a drag. With keyboard focus, Enter on a ruler adds a guide in
 * the middle of the view, arrows move a focused guide one document pixel (ten
 * with Shift) and Delete removes it. Canvas geometry is not mirrored in RTL.
 * Lay it over the canvas at the viewport's size; between its rulers and
 * guides it lets touches through.
 */
export function CanvasRuler({
  scope="canvas",revision=0,viewport,unit,dpi=DEFAULT_DPI,origin={x:0,y:0},guides,onAddGuide,onMoveGuide,onRemoveGuide,onGuidePreview,
  onOriginChange,pointer,thickness=RULER_THICKNESS,disabled=false,className,unstyled=false,style,...rest
}:CanvasRulerProps){
  validateViewport(viewport);
  validateGuides(guides);
  if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid ruler scope');
  if(![origin.x,origin.y,thickness,dpi,...(pointer?[pointer.x,pointer.y]:[])].every(Number.isFinite)||thickness<=0||dpi<=0)throw new RangeError('Invalid ruler geometry');
  // Validate units even when the viewport has no visible ticks.
  formatLength(0,unit,dpi);
  const boundary=JSON.stringify([scope,revision,viewport,unit,dpi,origin,guides,thickness,disabled]);
  const mounted=useRef(false),committed=useRef(boundary);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useLayoutEffect(()=>{committed.current=boundary;},[boundary]);
  const valid=()=>mounted.current&&committed.current===boundary&&!disabled;

  const [state,store]=useLocalStore<Local>(()=>({drag:undefined,focused:undefined}));
  const styled=!unstyled;
  const band=Math.max(RULER_TOUCH_BAND,thickness);
  const ctx:Ctx={valid,viewport,unit,dpi,origin,thickness,band,styled,disabled,store,
    preview:p=>{if(valid())onGuidePreview?.(p);},onAddGuide:g=>{if(valid())onAddGuide(g);},onMoveGuide:(id,position)=>{if(valid()&&guides.some(g=>g.id===id))onMoveGuide(id,position);},onRemoveGuide:id=>{if(valid()&&guides.some(g=>g.id===id))onRemoveGuide(id);},onOriginChange:onOriginChange?value=>{if(valid())onOriginChange(value);}:undefined};
  const ctxRef=useRef(ctx);
  useLayoutEffect(()=>{ctxRef.current=ctx;});
  useLayoutEffect(()=>{store.set(s=>({...s,drag:undefined,focused:s.focused&&guides.some(g=>g.id===s.focused)?s.focused:undefined}));},[boundary]);
  const drag=state.drag;
  const dragging=drag!==undefined;
  useEffect(()=>{
    // A press on the transparent part of a touch band focuses nothing, so on web
    // Escape is also heard on the window for as long as a drag lasts.
    const target=globalThis as {addEventListener?:(t:string,l:(e:{key?:string})=>void)=>void;removeEventListener?:(t:string,l:(e:{key?:string})=>void)=>void};
    if(!dragging||typeof target.addEventListener!=="function")return;
    const onKey=(e:{key?:string})=>{if(e.key==="Escape")cancelDrag(ctxRef.current);};
    target.addEventListener("keydown",onKey);
    return ()=>target.removeEventListener?.("keydown",onKey);
  },[dragging]);
  const live=drag?.kind==="guide"?drag:undefined;
  const livePosition=live?guidePositionAt(viewport,live.orientation,live.at):undefined;
  const liveRemoving=live?isOverOwnRuler(live.orientation,live.at,thickness):false;
  const zeroOf=(o:CanvasGuide["orientation"])=>o==="horizontal"?origin.y:origin.x;
  return <View {...rest} pointerEvents="box-none"
    {...{className:joinClasses(className)}}
    style={[{position:"absolute",left:0,top:0,width:viewport.width,height:viewport.height,overflow:"hidden",direction:"ltr"},style]}>
    {/* A dragged guide keeps its view mounted (it owns the gesture) and hides its stroke. */}
    {guides.map(g=><GuideLine key={g.id} guide={g} ctx={ctx} focused={state.focused===g.id} dragging={g.id===live?.id}/>)}
    {live&&livePosition!==undefined?<GuideStroke ctx={ctx} orientation={live.orientation}
      offset={docToScreen(viewport,guideAxis(live.orientation),livePosition)} removing={liveRemoving} emphasized/>:null}
    {drag?.kind==="origin"?<>
      <GuideStroke ctx={ctx} orientation="horizontal" offset={drag.at.y} removing={false} emphasized={false}/>
      <GuideStroke ctx={ctx} orientation="vertical" offset={drag.at.x} removing={false} emphasized={false}/>
    </>:null}
    <Ruler orientation="horizontal" ctx={ctx} pointer={pointer}/>
    <Ruler orientation="vertical" ctx={ctx} pointer={pointer}/>
    <Corner ctx={ctx}/>
    {live&&livePosition!==undefined?<Readout ctx={ctx} at={live.at}
      text={liveRemoving?(live.id?"Release to remove guide":"Release to cancel"):formatLength(livePosition-zeroOf(live.orientation),unit,dpi)}/>:null}
  </View>;
}

type Ctx={
  valid:()=>boolean;
  viewport:CanvasViewport;unit:RulerUnit;dpi:number;origin:DocPoint;thickness:number;band:number;styled:boolean;disabled:boolean;
  store:LocalStore<Local>;preview:(p:GuidePreview|undefined)=>void;
  onAddGuide:(g:NewCanvasGuide)=>void;onMoveGuide:(id:string,position:number)=>void;onRemoveGuide:(id:string)=>void;
  onOriginChange:((o:DocPoint)=>void)|undefined;
};

function previewOf(ctx:Ctx,d:Extract<Drag,{kind:"guide"}>):GuidePreview{
  return {...(d.id?{id:d.id}:{}),orientation:d.orientation,position:guidePositionAt(ctx.viewport,d.orientation,d.at),
    removing:isOverOwnRuler(d.orientation,d.at,ctx.thickness)};
}
/** Shared guide-drag lifecycle: rulers start new guides, guide lines move existing ones. */
function guideDragHandlers(ctx:Ctx,orientation:CanvasGuide["orientation"],toOverlay:(p:LocalPoint)=>LocalPoint,id?:string,start=0){
  const {store}=ctx;
  const current=()=>{const d=store.get().drag;return d?.kind==="guide"?d:undefined;};
  const update=(p:LocalPoint)=>{
    if(!ctx.valid())return;
    const d={kind:"guide" as const,orientation,at:toOverlay(p),start,...(id?{id}:{})};
    store.set(s=>({...s,drag:d}));
    ctx.preview(previewOf(ctx,d));
  };
  return {
    disabled:ctx.disabled,
    onBegin:update,
    onMove:(p:LocalPoint)=>{if(current())update(p);},
    onRelease:(p:LocalPoint)=>{
      if(!ctx.valid()||!current())return;
      if(!ctx.valid())return;
    const d={kind:"guide" as const,orientation,at:toOverlay(p),start,...(id?{id}:{})};
      store.set(s=>({...s,drag:undefined}));
      ctx.preview(undefined);
      const removing=isOverOwnRuler(orientation,d.at,ctx.thickness);
      const position=guidePositionAt(ctx.viewport,orientation,d.at);
      if(id===undefined){if(!removing)ctx.onAddGuide({orientation,position});return;}
      if(removing)ctx.onRemoveGuide(id);
      else if(position!==start)ctx.onMoveGuide(id,position);
    },
    onCancel:()=>cancelDrag(ctx),
  };
}
function cancelDrag(ctx:Ctx){
  if(!ctx.store.get().drag)return;
  ctx.store.set(s=>({...s,drag:undefined}));
  ctx.preview(undefined);
}

function Ruler({orientation,ctx,pointer}:{orientation:CanvasGuide["orientation"];ctx:Ctx;pointer:DocPoint|undefined}){
  const {viewport,thickness,band,styled,unit,dpi,origin}=ctx;
  const horizontal=orientation==="horizontal";
  const toOverlay=(p:LocalPoint)=>horizontal?{x:p.x+thickness,y:p.y}:{x:p.x,y:p.y+thickness};
  const handlers=useLocalPointer(guideDragHandlers(ctx,orientation,toOverlay));
  const ticks=rulerTicks({viewport,orientation,unit,dpi,origin}).filter(t=>t.offset>=thickness);
  const length=Math.max(0,(horizontal?viewport.width:viewport.height)-thickness);
  const name=horizontal?"Horizontal ruler":"Vertical ruler";
  const add=()=>{if(!ctx.disabled)ctx.onAddGuide({orientation,position:centerGuidePosition(viewport,orientation)});};
  const onKeyDown=(event:unknown)=>{
    const k=webKey(event);
    if(k.key==="Escape"){cancelDrag(ctx);return;}
    if(k.key==="Enter"||k.key===" "){stopKey(k);add();}
  };
  const marker=pointer?docToScreen(viewport,horizontal?"x":"y",horizontal?pointer.x:pointer.y)-thickness:undefined;
  // The 44-unit band takes touches; the visible strip inside it is the focus
  // target, so the keyboard ring hugs what is drawn.
  return <View {...handlers} collapsable={false}
    style={{position:"absolute",...(horizontal?{left:thickness,top:0,width:length,height:band}:{left:0,top:thickness,width:band,height:length}),...NO_SELECT}}>
    <View pointerEvents="box-only"
      accessible accessibilityRole="button" accessibilityLabel={name}
      accessibilityHint={`Counts in ${unit}. Drag into the canvas to place a ${orientation} guide, or activate to add one in the middle.`}
      accessibilityActions={[{name:"activate",label:`Add ${orientation} guide`}]}
      onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="activate")add();}}
      aria-disabled={ctx.disabled}
      {...{onKeyDown,focusable:!ctx.disabled,
        className:joinClasses(styled&&"bg-surface-raised border-border focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",styled&&(horizontal?"border-b":"border-r"))}}
      style={{position:"absolute",left:0,top:0,overflow:"hidden",...(horizontal?{width:length,height:thickness}:{width:thickness,height:length})}}>
      {ticks.map((t,i)=>{
        const at=t.offset-thickness;
        const size=t.level==="major"?thickness:t.level==="half"?thickness*0.45:thickness*0.25;
        return <View key={i} pointerEvents="none">
          <View {...{className:joinClasses(styled&&(t.level==="major"?"bg-text-muted":"bg-border"))}}
            style={horizontal?{position:"absolute",left:at,bottom:0,width:1,height:size}:{position:"absolute",top:at,right:0,height:1,width:size}}/>
          {/* Labels sit in a fixed-width box: on web numberOfLines caps a Text at its
              parent's width, which is only the ruler's thickness on the side ruler.
              Side-ruler labels are turned to read upward, ending at their tick. */}
          {t.label!==undefined?<View style={horizontal
            ?{position:"absolute",left:at+3,top:1,width:52,height:12}
            :{position:"absolute",left:thickness/2-26-2,top:at+3+26-6,width:52,height:12,transform:[{rotate:"-90deg"}]}}>
            <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text-muted")}}
              style={{fontSize:10,lineHeight:12,fontVariant:["tabular-nums"],textAlign:horizontal?"left":"right"}}>{t.label}</Text>
          </View>:null}
        </View>;
      })}
      {marker!==undefined&&marker>=0&&marker<=length?<View {...{className:joinClasses(styled&&"bg-accent")}}
        style={horizontal?{position:"absolute",left:marker,top:0,width:1,height:thickness}:{position:"absolute",top:marker,left:0,height:1,width:thickness}}/>:null}
    </View>
  </View>;
}

function GuideLine({guide,ctx,focused,dragging}:{guide:CanvasGuide;ctx:Ctx;focused:boolean;dragging:boolean}){
  const {viewport,band,styled,unit,dpi,origin,store}=ctx;
  const horizontal=guide.orientation==="horizontal";
  const offset=docToScreen(viewport,guideAxis(guide.orientation),guide.position);
  const half=band/2;
  const toOverlay=(p:LocalPoint)=>horizontal?{x:p.x,y:p.y+offset-half}:{x:p.x+offset-half,y:p.y};
  const handlers=useLocalPointer(guideDragHandlers(ctx,guide.orientation,toOverlay,guide.id,guide.position));
  const length=horizontal?viewport.width:viewport.height;
  const across=horizontal?viewport.height:viewport.width;
  if(offset<-half||offset>across+half)return null;
  const label=guideAccessibilityLabel(guide,unit,dpi,origin);
  const move=(delta:number)=>{if(!ctx.disabled)ctx.onMoveGuide(guide.id,tidy(guide.position+delta));};
  const remove=()=>{if(!ctx.disabled)ctx.onRemoveGuide(guide.id);};
  const onKeyDown=(event:unknown)=>{
    const k=webKey(event);
    if(k.key==="Escape"){cancelDrag(ctx);return;}
    const command=guideKeyCommand(guide.orientation,k.key,k.shiftKey===true);
    if(!command)return;
    stopKey(k);
    if(command.kind==="remove")remove();else move(command.delta);
  };
  return <View {...handlers} collapsable={false}
    accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityHint={horizontal?"Drag or use the up and down arrows to move. Drop on the ruler or press Delete to remove.":
      "Drag or use the left and right arrows to move. Drop on the ruler or press Delete to remove."}
    aria-valuenow={guide.position} aria-valuetext={formatLength(guide.position-(horizontal?origin.y:origin.x),unit,dpi)}
    accessibilityActions={[{name:"increment",label:horizontal?"Move down":"Move right"},
      {name:"decrement",label:horizontal?"Move up":"Move left"},{name:"remove",label:"Remove guide"}]}
    onAccessibilityAction={e=>{
      const a=e.nativeEvent.actionName;
      if(a==="increment")move(1);else if(a==="decrement")move(-1);else if(a==="remove")remove();
    }}
    aria-disabled={ctx.disabled}
    onFocus={()=>store.set(s=>({...s,focused:guide.id}))}
    onBlur={()=>store.set(s=>s.focused===guide.id?{...s,focused:undefined}:s)}
    {...{onKeyDown,focusable:!ctx.disabled,className:joinClasses(styled&&focused&&"border-2 border-focus rounded-control")}}
    style={{position:"absolute",justifyContent:"center",alignItems:"center",
      ...(horizontal?{left:0,width:length,top:offset-half,height:band}:{top:0,height:length,left:offset-half,width:band}),...NO_SELECT}}>
    <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-info")}}
      style={{...(horizontal?{width:"100%",height:focused?2:1}:{height:"100%",width:focused?2:1}),opacity:dragging?0:1}}/>
  </View>;
}

function GuideStroke({ctx,orientation,offset,removing,emphasized}:{
  ctx:Ctx;orientation:CanvasGuide["orientation"];offset:number;removing:boolean;emphasized:boolean;
}){
  const horizontal=orientation==="horizontal";
  return <View pointerEvents="none" {...{className:joinClasses(ctx.styled&&"bg-info")}}
    style={{position:"absolute",opacity:removing?0.35:emphasized?1:0.6,
      ...(horizontal?{left:0,right:0,top:offset-(emphasized?1:0.5),height:emphasized?2:1}:{top:0,bottom:0,left:offset-(emphasized?1:0.5),width:emphasized?2:1})}}/>;
}

function Readout({ctx,at,text}:{ctx:Ctx;at:LocalPoint;text:string}){
  const {viewport,styled}=ctx;
  const width=Math.min(180,Math.max(0,viewport.width-8));
  const left=Math.min(Math.max(4,at.x+14),Math.max(4,viewport.width-width-4));
  const top=Math.min(Math.max(ctx.thickness+4,at.y+14),Math.max(4,viewport.height-32));
  return <View pointerEvents="none" style={{position:"absolute",left,top,width,alignItems:"flex-start"}}>
    <Text accessibilityLiveRegion="polite" numberOfLines={1}
      {...{className:joinClasses(styled&&"bg-surface-raised border border-border rounded-control text-text text-xs")}}
      style={{paddingHorizontal:6,paddingVertical:3,fontVariant:["tabular-nums"]}}>{text}</Text>
  </View>;
}

function Corner({ctx}:{ctx:Ctx}){
  const {viewport,band,thickness,styled,unit,origin,store,onOriginChange}=ctx;
  const enabled=!ctx.disabled&&onOriginChange!==undefined;
  const reset=()=>{if(enabled&&(origin.x!==0||origin.y!==0))onOriginChange({x:0,y:0});};
  const handlers=useLocalPointer({
    disabled:!enabled,
    onBegin:p=>{if(ctx.valid())store.set(s=>({...s,drag:{kind:"origin",at:p,from:p}}));},
    onMove:p=>{if(ctx.valid())store.set(s=>s.drag?.kind==="origin"?{...s,drag:{...s.drag,at:p}}:s);},
    onRelease:p=>{
      const d=store.get().drag;
      if(!ctx.valid()||d?.kind!=="origin")return;
      store.set(s=>({...s,drag:undefined}));
      if(Math.hypot(p.x-d.from.x,p.y-d.from.y)<4){reset();return;}
      const doc=screenPointToDoc(viewport,p);
      onOriginChange?.({x:tidy(Math.round(doc.x)),y:tidy(Math.round(doc.y))});
    },
    onCancel:()=>cancelDrag(ctx),
  });
  const moved=origin.x!==0||origin.y!==0;
  return <View {...handlers} collapsable={false} style={{position:"absolute",left:0,top:0,width:band,height:band,...NO_SELECT}}>
    <View pointerEvents="box-only"
      accessible accessibilityRole="button"
      accessibilityLabel={`Ruler origin, ${unit}`}
      accessibilityHint={onOriginChange?(moved?"Drag to move the zero point, or activate to reset it to the document corner.":"Drag into the canvas to move the zero point."):undefined}
      aria-disabled={!enabled}
      {...{onKeyDown:(event:unknown)=>{
        const k=webKey(event);
        if(k.key==="Escape")cancelDrag(ctx);
        else if(k.key==="Enter"||k.key===" "){stopKey(k);reset();}
      },focusable:enabled,
      className:joinClasses(styled&&"bg-surface-raised border-border border-b border-r focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus")}}
      style={{width:thickness,height:thickness,alignItems:"center",justifyContent:"center"}}>
      <Text numberOfLines={1} {...{className:joinClasses(styled&&(moved?"text-accent":"text-text-muted"))}}
        style={{fontSize:forgeType.caption,fontWeight:"600"}}>{unit}</Text>
    </View>
  </View>;
}
