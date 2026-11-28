import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useRef} from "react";
import {Text,View,type ViewProps} from "react-native";
import {DragGrabHandle} from "@nyc-tron/ui/components/DragGrabHandle";
import {keyboardKey,type DragPoint,type DragTransport,type DragTransportProps,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {PanResponderDrag} from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {nudgePalette,placeFloatingPalette,shouldUndock,type PalettePosition,type PaletteRect} from "./floating-palette.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens } from "../tokens.ts";

/** Props for {@linkcode FloatingPaletteUndockHandle}. */
export interface FloatingPaletteUndockHandleProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly docked:boolean;
  /** The palette's current top-left in the host's coordinates: its docked spot, or its floating position. */
  readonly origin:PalettePosition;
  /** The palette's size, for keeping it on screen. */
  readonly size:{readonly width:number;readonly height:number};
  /** Area the floating palette must stay inside, in the same coordinates as `origin`. */
  readonly bounds:PaletteRect;
  /** Hinges, folds and cutouts the palette must not cover. */
  readonly obstacles?:readonly PaletteRect[]|undefined;
  /** Where to draw the palette during a drag; `undefined` when the drag ends or is cancelled. */
  readonly onPreview:(position:PalettePosition|undefined)=>void;
  /** A docked palette was dragged past the undock distance and released. One commit. */
  readonly onUndock:(position:PalettePosition,signal?:AbortSignal)=>void|Promise<unknown>;
  /** A floating palette was dragged or nudged to a new spot. One commit per release or key press. */
  readonly onMove:(position:PalettePosition,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Enter, Space or the screen-reader action on a floating palette. */
  readonly onDock:(signal?:AbortSignal)=>void|Promise<unknown>;
  /** @default "Color palette" */
  readonly label?:string;
  readonly disabled?:boolean;
  unstyled?:boolean;
}

/**
 * Grip that undocks, moves and re-docks a palette (B-28), built on
 * `DragGrabHandle`. Docked, nothing moves until the drag passes 30 units, so a
 * tap or a short slip does not tear the palette off; past that the preview
 * follows the pointer and release undocks it. Floating, the drag moves it and
 * release commits once. Positions are clamped to `bounds` and kept off
 * `obstacles` on every preview and commit. Escape cancels a drag. With
 * keyboard focus, Enter or Space toggles docking and the arrow keys move a
 * floating palette 8 units (Page Up/Down 32).
 */
export function FloatingPaletteUndockHandle({scope='palette-undock',revision=0,...props}:FloatingPaletteUndockHandleProps){
 const placement=placeFloatingPalette(props.origin,props.size,props.bounds,props.obstacles);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabled,props.disabledReason,props.docked,props.size,props.bounds,props.obstacles]);
 const guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined||placement.overlapsObstacle);
 return <FloatingPaletteUndockHandleBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||placement.overlapsObstacle||guard.pending}
  onPreview={value=>guard.current()?.onPreview(value)}
  onUndock={value=>guard.run('undock',(host,signal)=>host.onUndock(value,signal))} onMove={value=>guard.run('move',(host,signal)=>host.onMove(value,signal))}
  onDock={()=>guard.run('dock',(host,signal)=>host.onDock(signal))}/>;
}
function FloatingPaletteUndockHandleBody({
  actionError=null,disabledReason,docked,origin,size,bounds,obstacles=[],onPreview,onUndock,onMove,onDock,label="Color palette",
  disabled=false,unstyled=false,style,...rest
}:FloatingPaletteUndockHandleProps&{actionError?:string|null}){
  // `origin` is snapshotted when the drag starts. While floating, the host
  // redraws the palette at each preview, so a live `origin` would already
  // include the travel and every move would add it again.
  const drag=useRef<{start?:{x:number;y:number};origin:PalettePosition;armed:boolean;at?:PalettePosition}>({armed:false,origin});
  // `DragGrabHandle` reports moves but not where the press began; this
  // transport records the press point so the first few pixels count too.
  const pressed=useRef<DragPoint|undefined>(undefined);
  const transport=useRef<DragTransport|null>(null);
  if(!transport.current)transport.current=function PressPointDrag(props:DragTransportProps){
    return <PanResponderDrag {...props} onBegin={p=>{pressed.current=p;props.onBegin(p);}}/>;
  };
  const place=(p:PalettePosition)=>placeFloatingPalette(p,size,bounds,obstacles).position;
  const undockHere=()=>onUndock(place({x:origin.x,y:origin.y+8}));
  const onKeyDown=(event:KeyEventLike)=>{
    const key=keyboardKey(event);
    if(disabled)return;
    if(key==="Enter"||key===" "){
      (event as {preventDefault?:()=>void}).preventDefault?.();
      if(docked)undockHere();else onDock();
      return;
    }
    if(docked)return;
    const next=nudgePalette(origin,key);
    if(!next)return;
    (event as {preventDefault?:()=>void}).preventDefault?.();
    const placed=place(next);
    if(placed.x!==origin.x||placed.y!==origin.y)onMove(placed);
  };
  return <View {...{onKeyDown,focusable:!disabled,
      className:joinClasses(!unstyled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
    style={[{alignSelf:"center"},style]} {...rest}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {disabledReason?<Text accessibilityLiveRegion="polite">{disabledReason}</Text>:null}
    <DragGrabHandle label={docked?`Undock ${label.toLowerCase()}`:`Move ${label.toLowerCase()}`}
      disabled={disabled} unstyled={unstyled}
      accessibilityActions={docked?[{name:"activate",label:"Undock"}]:[{name:"activate",label:"Dock"}]}
      onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="activate"){if(docked)undockHere();else onDock();}}}
      transport={transport.current}
      onStart={()=>{drag.current={armed:!docked,origin,...(pressed.current?{start:pressed.current}:{})};}}
      onMove={p=>{
        const d=drag.current;
        if(!d.start){d.start=p;return;}
        const dx=p.x-d.start.x,dy=p.y-d.start.y;
        if(!d.armed&&shouldUndock(dx,dy))d.armed=true;
        if(!d.armed)return;
        d.at=place({x:d.origin.x+dx,y:d.origin.y+dy});
        onPreview(d.at);
      }}
      onCommit={()=>{
        const d=drag.current;
        drag.current={armed:false,origin};
        onPreview(undefined);
        if(!d.armed||!d.at)return;
        if(docked)onUndock(d.at);
        else if(d.at.x!==d.origin.x||d.at.y!==d.origin.y)onMove(d.at);
      }}
      onCancel={()=>{drag.current={armed:false,origin};onPreview(undefined);}}
      style={{minWidth:controlTokens.extent.field}}/>
  </View>;
}
