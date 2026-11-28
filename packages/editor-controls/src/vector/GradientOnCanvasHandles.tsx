import {gradientTargetCurrent} from './gradient-target-owner.ts';
import {createGradientPreviewOwner} from './gradient-preview-owner.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEffect,useLayoutEffect,useRef,type ReactNode} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {
  STOP_KEY_STEP,addStop,addStopAvailability,gradientAxis,gradientHandles,handleLabel,handleValueText,moveGradientHandle,
  moveStop,projectOnAxis,removeStop,removeStopAvailability,stopPoint,toggleFocal,validateGradient,
  type GradientHandle,
} from "./gradient-handles-model.ts";
import {
  IDENTITY_TRANSFORM,availabilityReason,deltaToContent,describeRgba,nudgeDelta,rgbaToCss,toContent,toView,
  validateTransform,
  type GradientPaint,type Point,type ViewTransform,
} from "./vector-types.ts";
import {CanvasKnob,LinePiece,NoticeLine,VectorButton,type CanvasKeyEvent,type DragModifiers} from "./vector-controls.tsx";

/** Props for {@linkcode GradientOnCanvasHandles}. The paint and stop selection are owned by the host. */
export interface GradientOnCanvasHandlesProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The layer's linear or radial fill. */
  paint:GradientPaint;
  /** Overlay size in points. */
  width:number;
  height:number;
  /** Content to view mapping. @default identity */
  transform?:ViewTransform;
  /** Index of the selected stop, or `undefined`. */
  selectedStop:number|undefined;
  onSelectStop:(index:number|undefined)=>void;
  /** Paint to draw during a drag; `undefined` when it ends or is cancelled. */
  onPreview?:(paint:GradientPaint|undefined)=>void;
  /** One call per drag release, key press, added or deleted stop. Maps to `setFill {id, fill}`. */
  onSetFill:(paint:GradientPaint,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Canvas content drawn under the handles; it never takes touches while they are mounted. */
  children?:ReactNode;
  /** Show the stop and focal commands under the overlay. @default true */
  showCommands?:boolean;
  /** Geometry-only overlays (e.g. photo masks) do not expose or add paint stops. */
  geometryOnly?:boolean;
  /** @default "Gradient" */
  label?:string;
  /** Optional override; defaults to the theme's accent token. */
  accentColor?:string;
  className?:string;
  unstyled?:boolean;
}

type Target={kind:"handle";handle:GradientHandle}|{kind:"stop";index:number};
type Drag={target:Target;start:GradientPaint;moved:boolean;cancelled:boolean;last?:GradientPaint};
type Local={preview:GradientPaint|null;notice:string|undefined};
/** Stops ride a rail this far (points) to the side of the gradient axis, clear of the end handles. */
const STOP_RAIL=24;
/** Tap distance (points) from the stop rail that adds a stop. */
const RAIL_TOLERANCE=14;
const TAP_SLOP=3;
// Web only: a drag otherwise selects nearby text. Not a ViewStyle key in RN.
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none"}:{}) as object;
const HINT="Drag the handles to place the gradient; drag the end handle to rotate it. Tap the stop rail to add a stop.";
const MOVE_ACTIONS=[
  {name:"moveLeft",label:"Move left"},{name:"moveRight",label:"Move right"},
  {name:"moveUp",label:"Move up"},{name:"moveDown",label:"Move down"},
];
const ACTION_DELTA:Record<string,Point|undefined>={
  moveLeft:{x:-1,y:0},moveRight:{x:1,y:0},moveUp:{x:0,y:-1},moveDown:{x:0,y:1},
};

/**
 * On-canvas gradient editor (B-24). A linear gradient shows start and end
 * handles; dragging the end handle also rotates it, Shift snaps the angle to
 * 15 degrees. A radial gradient shows its center, a radius handle and, once
 * added, a focal point kept strictly inside the circle. Stops sit on a rail
 * beside the axis: drag one to change its offset, tap the rail to add one,
 * Delete removes the selected stop. Arrow keys nudge the focused handle by 1
 * unit (Shift: 10) or a stop by 1% (Shift: 10%). Escape cancels a drag. Each
 * release or key press commits once through `onSetFill`.
 */
export function GradientOnCanvasHandles({scope='gradient-handles',revision=0,...props}:GradientOnCanvasHandlesProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.width,props.height,props.transform,props.paint]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 const previewOwner=useRef<ReturnType<typeof createGradientPreviewOwner<GradientPaint>>|null>(null);
 if(!previewOwner.current)previewOwner.current=createGradientPreviewOwner<GradientPaint>();
 const previews=previewOwner.current;
 useLayoutEffect(()=>()=>previews.clear(owner),[owner,previews]);
 return <GradientOnCanvasHandlesBody gestureBoundary={owner} {...props} actionError={guard.error} busy={guard.pending}
  onSetFill={value=>guard.run('onSetFill',(host,signal)=>host.onSetFill(value,signal))}
  onSelectStop={index=>guard.current()?.onSelectStop(index)}
  onPreview={value=>{if(value===undefined){previews.clear(owner);return;}const host=guard.current();if(host?.onPreview)previews.publish(owner,host.onPreview,value);}}/>;
}
function GradientOnCanvasHandlesBody({
  gestureBoundary,actionError=null,busy=false,disabledReason,
  paint,width,height,transform=IDENTITY_TRANSFORM,selectedStop,onSelectStop,onPreview,onSetFill,children,
  showCommands=true,geometryOnly=false,label="Gradient",accentColor,className,unstyled=false,style,...rest
}:GradientOnCanvasHandlesProps&{gestureBoundary:string;actionError?:string|null;busy?:boolean}){
  validateGradient(paint);
  validateTransform(transform);
  if(![width,height].every(Number.isFinite)||width<=0||height<=0)throw new RangeError("Invalid overlay size");
  const latest=useRef({paint,transform,selectedStop,onSelectStop,onPreview,onSetFill});
  useLayoutEffect(()=>{latest.current={paint,transform,selectedStop,onSelectStop,onPreview,onSetFill};});
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({preview:null,notice:undefined}));
  const store=local.current;
  const preview=useStore(store,s=>s.preview);
  const notice=useStore(store,s=>s.notice);
  const drag=useRef<Drag|null>(null);
  const pressAt=useRef<Point|null>(null);
  const shown=preview??paint;
  const styled=!unstyled;
  const selected=selectedStop!==undefined&&shown.stops[selectedStop]?selectedStop:undefined;
  useEffect(()=>()=>{if(drag.current)latest.current.onPreview?.(undefined);},[]);

  const geometryBoundary=JSON.stringify([gestureBoundary,paint,transform,width,height,disabledReason,busy]);
  const committedGesture=useRef(geometryBoundary);
  const admitted=()=>committedGesture.current===geometryBoundary&&disabledReason===undefined&&!busy;
  const currentTarget=(target:Target)=>gradientTargetCurrent(geometryBoundary,committedGesture.current,disabledReason!==undefined||busy,latest.current.paint,target);
  useLayoutEffect(()=>{committedGesture.current=geometryBoundary;drag.current=null;pressAt.current=null;clearPreview();store.setState({notice:undefined});},[geometryBoundary]);

  const view=(q:Point)=>toView(transform,q);
  // Rail geometry in view space: the axis shifted sideways by STOP_RAIL.
  const rail=(p:GradientPaint,t:ViewTransform)=>{
    const {from,to}=gradientAxis(p);
    const a=toView(t,from),b=toView(t,to);
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
    const n={x:-dy/len*STOP_RAIL,y:dx/len*STOP_RAIL};
    return {a:{x:a.x+n.x,y:a.y+n.y},b:{x:b.x+n.x,y:b.y+n.y},n};
  };
  const clearPreview=()=>{
    if(store.getState().preview===null)return;
    store.setState({preview:null});
    latest.current.onPreview?.(undefined);
  };
  const cancelDrag=()=>{
    if(!admitted())return false;
    const d=drag.current;
    if(!d)return false;
    d.cancelled=true;
    clearPreview();
    return true;
  };
  const begin=(target:Target)=>{
    if(!currentTarget(target))return;
    const p=latest.current;
    drag.current={target,start:p.paint,moved:false,cancelled:false};
    if(target.kind==="stop"&&p.selectedStop!==target.index)p.onSelectStop(target.index);
    store.setState({notice:undefined});
  };
  const dragTo=(dx:number,dy:number,mods:DragModifiers)=>{
    if(!admitted())return;
    const d=drag.current;
    if(!d||d.cancelled||disabledReason!==undefined||busy)return;
    if(!d.moved&&Math.hypot(dx,dy)<TAP_SLOP)return;
    d.moved=true;
    const t=latest.current.transform;
    let next:GradientPaint;
    if(d.target.kind==="handle"){
      const from=gradientHandles(d.start).find(h=>h.handle===(d.target as {handle:GradientHandle}).handle)!.point;
      const c=deltaToContent(t,dx,dy);
      next=moveGradientHandle(d.start,d.target.handle,{x:from.x+c.x,y:from.y+c.y},mods.shift);
    }else{
      const at=view(stopPoint(d.start,d.start.stops[d.target.index]!.offset));
      const q=toContent(t,{x:at.x+dx,y:at.y+dy});
      next=moveStop(d.start,d.target.index,projectOnAxis(d.start,q).offset);
    }
    d.last=next;
    store.setState({preview:next});
    latest.current.onPreview?.(next);
  };
  const release=()=>{
    if(!admitted())return;
    const d=drag.current;
    drag.current=null;
    if(!d||d.cancelled||disabledReason!==undefined||busy)return;
    clearPreview();
    if(d.moved&&d.last)latest.current.onSetFill(d.last);
  };
  const block=(reason:string)=>store.setState({notice:reason});
  const deleteStop=(index:number|undefined)=>{
    if(!admitted())return;
    const p=latest.current;
    const reason=availabilityReason(removeStopAvailability(p.paint,index));
    if(reason!==undefined||index===undefined){block(reason??"");return;}
    store.setState({notice:undefined});
    p.onSetFill(removeStop(p.paint,index));
    p.onSelectStop(Math.min(index,p.paint.stops.length-2));
  };
  const addAt=(offset:number)=>{
    if(!admitted())return;
    const p=latest.current;
    const reason=availabilityReason(addStopAvailability(p.paint));
    if(reason!==undefined){block(reason);return;}
    const result=addStop(p.paint,offset);
    store.setState({notice:undefined});
    p.onSetFill(result.paint);
    p.onSelectStop(result.index);
  };
  const addBetween=()=>{
    if(!admitted())return;
    const p=latest.current;
    const i=p.selectedStop??0;
    const a=p.paint.stops[i]?.offset??0,b=p.paint.stops[i+1]?.offset??Math.min(1,a+0.2);
    addAt(i+1<p.paint.stops.length?(a+b)/2:(p.paint.stops[i-1]!.offset+a)/2);
  };
  const nudge=(target:Target,key:string|undefined,shift:boolean)=>{
    if(!currentTarget(target))return false;
    const p=latest.current;
    if(target.kind==="handle"){
      const d=nudgeDelta(key,shift);
      if(!d)return false;
      const found=gradientHandles(p.paint).find(h=>h.handle===target.handle);
      if(!found)return false;
      const from=found.point;
      p.onSetFill(moveGradientHandle(p.paint,target.handle,{x:from.x+d.x,y:from.y+d.y}));
      return true;
    }
    const step=(shift?10:1)*STOP_KEY_STEP;
    const dir=key==="ArrowRight"||key==="ArrowUp"?1:key==="ArrowLeft"||key==="ArrowDown"?-1:0;
    if(dir===0)return false;
    const stop=p.paint.stops[target.index]!;
    const next=moveStop(p.paint,target.index,stop.offset+dir*step);
    if(next.stops[target.index]!.offset!==stop.offset)p.onSetFill(next);
    else block("This stop cannot pass its neighbours");
    return true;
  };
  const onKnobKey=(target:Target)=>(event:CanvasKeyEvent)=>{
    if(!currentTarget(target))return;
    const key=keyboardKey(event);
    const shift=event.shiftKey??event.nativeEvent?.shiftKey??false;
    if(key==="Escape"){
      if(!cancelDrag()&&target.kind==="stop")latest.current.onSelectStop(undefined);
      event.preventDefault?.();
      return;
    }
    if(target.kind==="stop"&&(key==="Delete"||key==="Backspace")){event.preventDefault?.();deleteStop(target.index);return;}
    if(nudge(target,key,shift))event.preventDefault?.();
  };
  const onRootKey=(event:CanvasKeyEvent)=>{
    if(!admitted())return;
    if(keyboardKey(event)==="Escape"&&drag.current){cancelDrag();event.preventDefault?.();}
  };

  const canvasHandlers=useLocalPointer({
    onBegin:point=>{if(admitted())pressAt.current=point;},
    onMove:()=>{},
    onRelease:point=>{
      if(!admitted())return;
      if(geometryOnly){pressAt.current=null;return;}
      const start=pressAt.current;
      pressAt.current=null;
      if(!start||Math.hypot(point.x-start.x,point.y-start.y)>TAP_SLOP*2)return;
      const p=latest.current;
      const r=rail(p.paint,p.transform);
      // Project onto the rail, then read the offset from the matching axis point.
      const q=toContent(p.transform,{x:point.x-r.n.x,y:point.y-r.n.y});
      const hit=projectOnAxis(p.paint,q);
      const onRail=Math.hypot(...(()=>{
        const v=view(stopPoint(p.paint,hit.offset));
        return [point.x-(v.x+r.n.x),point.y-(v.y+r.n.y)] as [number,number];
      })())<=RAIL_TOLERANCE;
      if(onRail)addAt(hit.offset);
      else if(p.selectedStop!==undefined)p.onSelectStop(undefined);
    },
    onCancel:()=>{pressAt.current=null;},
  });

  const accentLine=joinClasses(styled&&!accentColor&&"bg-accent");
  const {from,to}=gradientAxis(shown);
  const r=rail(shown,transform);
  const circle=shown.type==="radial"?Array.from({length:49},(_,i)=>{
    const a=i/48*Math.PI*2;
    return view({x:shown.cx+Math.cos(a)*shown.r,y:shown.cy+Math.sin(a)*shown.r});
  }):[];
  const handleGlyph=(handle:GradientHandle)=>{
    const round=handle==="radius"||handle==="focal";
    return <View pointerEvents="none"
      {...{className:joinClasses(styled&&"bg-surface-raised",styled&&!accentColor&&"border-accent")}}
      style={{width:14,height:14,borderWidth:handle==="focal"?3:2,borderRadius:round?7:2,
        ...(accentColor?{borderColor:accentColor}:null)}}/>;
  };
  return <View {...rest} {...{onKeyDown:onRootKey,className:joinClasses("gap-2",className)}}
    style={[{alignSelf:"flex-start",maxWidth:"100%"},style]}>
    <ErrorMessage message={actionError??undefined} unstyled={unstyled}/>
    {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Applying change"}</Text>:null}
    <View {...canvasHandlers} accessibilityLabel={label} testID="gradient-canvas"
      {...{className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border")}}
      style={{width,height,position:"relative",direction:"ltr",...NO_SELECT}}>
      <View pointerEvents="none" style={{position:"absolute",left:0,top:0,width,height}}>{children}</View>
      {circle.slice(1).map((pt,i)=><LinePiece key={"c"+i} from={circle[i]!} to={pt} thickness={1} opacity={0.7}
        className={accentLine} color={accentColor}/>)}
      <LinePiece from={view(from)} to={view(to)} thickness={2} className={accentLine} color={accentColor}/>
      {!geometryOnly?<LinePiece from={r.a} to={r.b} thickness={1} className={joinClasses(styled&&"bg-text-muted")}/>:null}
      {gradientHandles(shown).map(({handle,point})=>{
        const target:Target={kind:"handle",handle};
        return <CanvasKnob key={handle} at={view(point)} selected={false} styled={styled} zIndex={handle==="focal"?3:2}
          testID={"gradient-"+handle}
          label={`${handleLabel(handle)}, ${handleValueText(shown,handle)}`}
          hint={handle==="end"?"Drag to move or rotate. Shift snaps the angle.":"Drag or use arrow keys to move."}
          actions={MOVE_ACTIONS}
          onAction={name=>{if(!currentTarget(target))return;const d=ACTION_DELTA[name];if(d){
            const p=latest.current;
            const found=gradientHandles(p.paint).find(h=>h.handle===handle);
            if(!found)return;
            const at=found.point;
            p.onSetFill(moveGradientHandle(p.paint,handle,{x:at.x+d.x,y:at.y+d.y}));
          }}}
          onKeyDown={onKnobKey(target)}
          onBegin={()=>begin(target)} onMove={dragTo} onRelease={release} onCancel={cancelDrag}>
          {handleGlyph(handle)}
        </CanvasKnob>;
      })}
      {!geometryOnly&&shown.stops.map((stop,index)=>{
        const v=view(stopPoint(shown,stop.offset));
        const isSel=selected===index;
        const target:Target={kind:"stop",index};
        return <CanvasKnob key={"s"+index} at={{x:v.x+r.n.x,y:v.y+r.n.y}} selected={isSel} styled={styled} zIndex={4}
          testID={"gradient-stop-"+index}
          label={`Stop ${index+1} of ${shown.stops.length}, ${Math.round(stop.offset*100)}%, ${describeRgba(stop.color)}`}
          hint="Drag along the rail or use arrow keys to move. Delete removes it."
          actions={[{name:"activate",label:"Select"},{name:"increment",label:"Move forward"},
            {name:"decrement",label:"Move back"},{name:"remove",label:"Delete stop"}]}
          onAction={name=>{
            if(!currentTarget(target))return;
            const p=latest.current;
            if(name==="activate")p.onSelectStop(index);
            else if(name==="increment")nudge(target,"ArrowRight",false);
            else if(name==="decrement")nudge(target,"ArrowLeft",false);
            else if(name==="remove")deleteStop(index);
          }}
          onFocus={()=>{if(!currentTarget(target))return;if(latest.current.selectedStop!==index)latest.current.onSelectStop(index);}}
          onKeyDown={onKnobKey(target)}
          onBegin={()=>begin(target)} onMove={dragTo} onRelease={release} onCancel={cancelDrag}>
          <View pointerEvents="none"
            {...{className:joinClasses(styled&&"border-surface-raised")}}
            style={{width:isSel?20:16,height:isSel?20:16,borderRadius:4,borderWidth:2,backgroundColor:rgbaToCss(stop.color)}}>
            <View {...{className:joinClasses(styled&&(isSel?"border-focus":"border-text-muted"))}}
              style={{position:"absolute",left:-4,top:-4,right:-4,bottom:-4,borderRadius:6,borderWidth:isSel?2:1}}/>
          </View>
        </CanvasKnob>;
      })}
    </View>
    {showCommands&&!geometryOnly?<View accessibilityRole="toolbar" aria-label="Gradient commands"
      style={{flexDirection:"row",flexWrap:"wrap",gap:6,maxWidth:Math.max(width,320)}}>
      <VectorButton label="Add stop" styled={styled} onBlocked={block} onPress={addBetween}
        reason={availabilityReason(addStopAvailability(shown))}/>
      <VectorButton label="Delete stop" styled={styled} onBlocked={block} onPress={()=>deleteStop(latest.current.selectedStop)}
        reason={availabilityReason(removeStopAvailability(shown,selected))}/>
      {shown.type==="radial"?<VectorButton label={shown.fx===undefined?"Add focal point":"Remove focal point"} styled={styled}
        onBlocked={block} onPress={()=>{
          const p=latest.current.paint;
          if(p.type==="radial"){store.setState({notice:undefined});latest.current.onSetFill(toggleFocal(p));}
        }}/>:null}
    </View>:null}
    {showCommands&&!geometryOnly?<NoticeLine text={notice??HINT} styled={styled} testID="gradient-notice"/>:null}
  </View>;
}
