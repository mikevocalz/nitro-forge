import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useLayoutEffect,useRef,type ReactNode} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {keyboardKey} from "@nyc-tron/ui/components/gestures/drag-transport";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {
  NODE_KINDS,PEN_HANDLE_SIZE,PEN_INSERT_TOLERANCE,PEN_NODE_SIZE,PEN_TAP_SLOP,
  closeAvailability,convertNodeKind,hitPath,insertAfterAvailability,isNodeRef,kindAvailability,moveHandle,moveNode,
  nodeAccessibilityLabel,nodeAt,nodeKindLabel,removeAvailability,replaceNode,sampleSegment,segmentControls,segmentCount,
  splitSegment,validateSubpaths,
  type HandleSide,type InsertNodeIntent,type NodeKindIntent,
} from "./pen-node-model.ts";
import {
  IDENTITY_TRANSFORM,availabilityReason,deltaToContent,nudgeDelta,toView,validateTransform,
  type HandleOffset,type NodeKind,type NodeRef,type PathNode,type Point,type Subpath,type ViewTransform,
} from "./vector-types.ts";
import {CanvasKnob,LinePiece,NoticeLine,VectorButton,type CanvasKeyEvent,type DragModifiers} from "./vector-controls.tsx";
import {exact} from '../exact-optional.ts';

/** Source contract for hosts that require scoped, focus-preserving canvas edits.
 * Older alpha.4 artifacts omit this marker; availability must be detected at runtime. */
export const PEN_NODE_EDITOR_CAPABILITIES = Object.freeze({
  version: 1 as const,
  scopedInteractions: true as const,
  geometryCancellation: true as const,
  stableGeometryFocus: true as const,
});

/** `setPathNode` intent: replace one node. */
export interface SetPathNodeIntent extends NodeRef {
  readonly node:PathNode;
}
/** `setSubpathClosed` intent. */
export interface SetClosedIntent {
  readonly subpath:number;
  readonly closed:boolean;
}

/** Props for {@linkcode PenNodeEditor}. The path, selection and every edit are owned by the host. */
export interface PenNodeEditorProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The path layer's subpaths, in content coordinates. */
  subpaths:readonly Subpath[];
  /** Optional content-coordinate snapping. The host must return finite coordinates. */
  editScope?:string;
  editRevision?:string|number;
  snapPoint?:(point:Point,ref:NodeRef)=>Point;
  snapHandle?:(offset:HandleOffset,node:PathNode,ref:NodeRef)=>HandleOffset;
  /** Overlay size in points; place it over the canvas region the transform maps into. */
  width:number;
  height:number;
  /** Content to view mapping (zoom, pan, layer transform). @default identity */
  transform?:ViewTransform;
  /** The selected node, or `undefined`. */
  selection:NodeRef|undefined;
  onSelectionChange:(ref:NodeRef|undefined)=>void;
  /** The path to draw during a drag; `undefined` when the drag ends or is cancelled. Never persist here. */
  onPreview?:(subpaths:readonly Subpath[]|undefined)=>void;
  /** A node or handle was dragged and released, or nudged by one key press. Maps to `setPathNode`. */
  onSetPathNode:(intent:SetPathNodeIntent,signal?:AbortSignal)=>void|Promise<unknown>;
  /**
   * A tap on the outline or the "Add node" command split a segment. Maps to
   * `insertPathNode` when {@linkcode InsertNodeIntent.neighborsChanged} is false,
   * otherwise `setPathNodes` with {@linkcode InsertNodeIntent.subpaths}.
   */
  onInsertNode:(intent:InsertNodeIntent,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Delete, Backspace or the command removed a node. Maps to `removePathNode`. */
  onRemoveNode:(ref:NodeRef,signal?:AbortSignal)=>void|Promise<unknown>;
  /**
   * The node kind changed. Maps to `setNodeKind`, or to `setPathNode` with
   * {@linkcode NodeKindIntent.node} when {@linkcode NodeKindIntent.handlesChanged}.
   */
  onSetNodeKind:(intent:NodeKindIntent,signal?:AbortSignal)=>void|Promise<unknown>;
  /** The selected node's subpath was closed or opened. Maps to `setSubpathClosed`. */
  onSetClosed:(intent:SetClosedIntent,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Canvas content drawn under the overlay. It never takes touches while the editor is mounted. */
  children?:ReactNode;
  /** Show the node command bar under the overlay. @default true */
  showCommands?:boolean;
  /** @default "Path nodes" */
  label?:string;
  /** Optional override; defaults to the theme's accent token. */
  accentColor?:string;
  className?:string;
  unstyled?:boolean;
}

type Target={kind:"node";ref:NodeRef}|{kind:"handle";ref:NodeRef;side:HandleSide};
type Drag={target:Target;start:readonly Subpath[];node:PathNode;moved:boolean;cancelled:boolean;last?:PathNode};
type Local={preview:readonly Subpath[]|null;notice:string|undefined};
type KeyEvent=CanvasKeyEvent;
// Web only: a drag otherwise selects nearby text. Not a ViewStyle key in RN.
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none"}:{}) as object;
const HINT="Drag a node or handle. Tap the outline to add a node. Hold Alt while dragging a handle to break it.";
const sideLabel=(side:HandleSide)=>side==="in"?"Incoming handle":"Outgoing handle";

/**
 * On-canvas node editor for one path layer (B-21). Draws the path outline,
 * its nodes and the selected node's Bézier handles over the host's canvas.
 * Drag a node to move it; drag a handle to reshape (smooth keeps the handles
 * collinear, symmetric mirrors their length, Alt breaks them into a corner).
 * Tapping the outline splits the segment there without changing its shape.
 * Arrow keys nudge the focused node or handle by 1 unit (Shift: 10), Delete
 * removes the node, Escape cancels a drag. Every release or key press commits
 * once; previews go through `onPreview`.
 *
 * Curves are drawn as short straight pieces sampled from the exact Bézier, so
 * the overlay needs no SVG dependency; the engine renders the real curve.
 */
export function PenNodeEditor({scope,revision,editScope,editRevision,...props}:PenNodeEditorProps){
 const id=scope??editScope??'path-nodes',version=revision??editRevision??0;
 const owner=JSON.stringify([...controlIdentity(id,version),props.disabledReason,props.width,props.height,props.transform]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 // Revision effects discard stale gestures without replacing the focused keyboard target.
 return <PenNodeEditorBody key={id} {...props} editScope={id} editRevision={version} actionError={guard.error} busy={guard.pending}
  onSelectionChange={value=>guard.current()?.onSelectionChange(value)} onPreview={value=>guard.current()?.onPreview?.(value)}
  onSetPathNode={value=>guard.run('onSetPathNode',(host,signal)=>host.onSetPathNode(value,signal))}
  onInsertNode={value=>guard.run('onInsertNode',(host,signal)=>host.onInsertNode(value,signal))}
  onRemoveNode={value=>guard.run('onRemoveNode',(host,signal)=>host.onRemoveNode(value,signal))}
  onSetNodeKind={value=>guard.run('onSetNodeKind',(host,signal)=>host.onSetNodeKind(value,signal))}
  onSetClosed={value=>guard.run('onSetClosed',(host,signal)=>host.onSetClosed(value,signal))}
/>;
}
function PenNodeEditorBody({
  actionError=null,busy=false,disabledReason,
  subpaths,snapPoint,snapHandle,editScope,editRevision,width,height,transform=IDENTITY_TRANSFORM,selection,onSelectionChange,onPreview,onSetPathNode,
  onInsertNode,onRemoveNode,onSetNodeKind,onSetClosed,children,showCommands=true,label="Path nodes",
  accentColor,className,unstyled=false,style,...rest
}:PenNodeEditorProps&{actionError?:string|null;busy?:boolean}){
  validateSubpaths(subpaths);
  validateTransform(transform);
  if(![width,height].every(Number.isFinite)||width<=0||height<=0)throw new RangeError("Invalid editor size");
  const latest=useRef({subpaths,snapPoint,snapHandle,transform,selection,onSelectionChange,onPreview,onSetPathNode,onInsertNode,
    onRemoveNode,onSetNodeKind,onSetClosed});
  latest.current={subpaths,snapPoint,snapHandle,transform,selection,onSelectionChange,onPreview,onSetPathNode,onInsertNode,
    onRemoveNode,onSetNodeKind,onSetClosed};
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({preview:null,notice:undefined}));
  const store=local.current;
  const preview=useStore(store,s=>s.preview);
  const notice=useStore(store,s=>s.notice);
  const drag=useRef<Drag|null>(null);
  const altHeld=useRef(false);
  const pressAt=useRef<Point|null>(null);
  const shown=preview??subpaths;
  const selected=isNodeRef(shown,selection)?selection:undefined;
  const styled=!unstyled;

  const clearPreview=()=>{
    if(store.getState().preview===null)return;
    store.setState({preview:null});
    latest.current.onPreview?.(undefined);
  };
  useLayoutEffect(()=>()=>{drag.current=null;pressAt.current=null;if(store.getState().preview!==null){store.setState({preview:null});latest.current.onPreview?.(undefined);}},[store,editScope,editRevision]);
  const geometryBoundary=JSON.stringify([subpaths,transform,width,height,disabledReason,busy]);
  useLayoutEffect(()=>{drag.current=null;pressAt.current=null;clearPreview();},[geometryBoundary]);
  const cancelDrag=()=>{
    const d=drag.current;
    if(!d)return false;
    d.cancelled=true;
    clearPreview();
    return true;
  };
  const begin=(target:Target)=>{
    if(drag.current){cancelDrag();return;}
    const p=latest.current;
    drag.current={target,start:p.subpaths,node:nodeAt(p.subpaths,target.ref),moved:false,cancelled:false};
    const sel=p.selection;
    if(!sel||sel.subpath!==target.ref.subpath||sel.index!==target.ref.index)p.onSelectionChange(target.ref);
    store.setState({notice:undefined});
  };
  const snappedNode=(node:PathNode,ref:NodeRef):PathNode=>{
    const point=latest.current.snapPoint?.({x:node.x,y:node.y},ref);
    if(!point)return node;
    if(![point.x,point.y].every(Number.isFinite))throw new RangeError("Snapped point must be finite");
    return {...node,x:point.x,y:point.y};
  };
  const snappedHandle=(offset:HandleOffset,node:PathNode,ref:NodeRef):HandleOffset=>{
    const next=latest.current.snapHandle?.(offset,node,ref)??offset;
    if(next.length!==2||!next.every(Number.isFinite))throw new RangeError("Snapped handle must be finite");
    return next;
  };
  const dragTo=(dx:number,dy:number,mods:DragModifiers)=>{
    const d=drag.current;
    if(!d||d.cancelled)return;
    if(!d.moved&&Math.hypot(dx,dy)<PEN_TAP_SLOP)return;
    d.moved=true;
    const c=deltaToContent(latest.current.transform,dx,dy);
    let node:PathNode;
    if(d.target.kind==="node")node=snappedNode(moveNode(d.node,c.x,c.y),d.target.ref);
    else{
      const h=d.node[d.target.side] as HandleOffset;
      node=moveHandle(d.node,d.target.side,snappedHandle([h[0]+c.x,h[1]+c.y],d.node,d.target.ref),mods.alt||altHeld.current);
    }
    d.last=node;
    const next=replaceNode(d.start,d.target.ref,node);
    store.setState({preview:next});
    latest.current.onPreview?.(next);
  };
  const release=()=>{
    const d=drag.current;
    drag.current=null;
    if(!d||d.cancelled)return;
    if(!d.moved||!d.last){clearPreview();return;}
    // Clear before the commit so the host's next render shows its own value.
    clearPreview();
    latest.current.onSetPathNode({subpath:d.target.ref.subpath,index:d.target.ref.index,node:d.last});
  };

  const block=(reason:string)=>store.setState({notice:reason});
  const removeSelected=(at?:NodeRef)=>{
    const p=latest.current;
    const ref=at??p.selection;
    const reason=availabilityReason(removeAvailability(p.subpaths,ref));
    if(reason!==undefined||!ref){block(reason??"");return;}
    store.setState({notice:undefined});
    p.onRemoveNode({subpath:ref.subpath,index:ref.index});
    // Keep a selection so Delete can be pressed again: the node that took this index, else the new last one.
    const left=p.subpaths[ref.subpath]!.nodes.length-1;
    p.onSelectionChange({subpath:ref.subpath,index:Math.min(ref.index,left-1)});
  };
  const insertAfter=(at?:NodeRef)=>{
    const p=latest.current;
    const ref=at??p.selection;
    const reason=availabilityReason(insertAfterAvailability(p.subpaths,ref));
    if(reason!==undefined||!ref){block(reason??"");return;}
    const intent=splitSegment(p.subpaths,ref.subpath,ref.index,0.5);
    store.setState({notice:undefined});
    p.onInsertNode(intent);
    p.onSelectionChange({subpath:intent.subpath,index:intent.index});
  };
  const setKind=(kind:NodeKind,at?:NodeRef)=>{
    const p=latest.current;
    const ref=at??p.selection;
    const reason=availabilityReason(kindAvailability(p.subpaths,ref));
    if(reason!==undefined||!ref){block(reason??"");return;}
    if(nodeAt(p.subpaths,ref).kind===kind)return;
    store.setState({notice:undefined});
    p.onSetNodeKind(convertNodeKind(p.subpaths,ref,kind));
  };
  const toggleClosed=()=>{
    const p=latest.current;
    const reason=availabilityReason(closeAvailability(p.subpaths,p.selection));
    if(reason!==undefined){block(reason);return;}
    const sp=p.subpaths[p.selection!.subpath]!;
    store.setState({notice:undefined});
    p.onSetClosed({subpath:p.selection!.subpath,closed:!sp.closed});
  };
  const nudge=(target:Target,delta:Point,alt:boolean)=>{
    const p=latest.current;
    const node=nodeAt(p.subpaths,target.ref);
    let next:PathNode;
    if(target.kind==="node")next=snappedNode(moveNode(node,delta.x,delta.y),target.ref);
    else{
      const h=node[target.side];
      if(!h)return;
      next=moveHandle(node,target.side,snappedHandle([h[0]+delta.x,h[1]+delta.y],node,target.ref),alt);
    }
    p.onSetPathNode({subpath:target.ref.subpath,index:target.ref.index,node:next});
  };
  const onKnobKey=(target:Target)=>(event:KeyEvent)=>{
    const key=keyboardKey(event);
    const shift=event.shiftKey??event.nativeEvent?.shiftKey??false;
    const alt=event.altKey??event.nativeEvent?.altKey??false;
    if(key==="Escape"){
      if(!cancelDrag()&&target.kind==="node")latest.current.onSelectionChange(undefined);
      event.preventDefault?.();
      return;
    }
    const delta=nudgeDelta(key,shift);
    if(delta){event.preventDefault?.();nudge(target,delta,alt);return;}
    if(target.kind==="node"&&(key==="Delete"||key==="Backspace")){event.preventDefault?.();removeSelected(target.ref);}
  };
  const onRootKey=(event:KeyEvent)=>{
    const key=keyboardKey(event);
    if(key==="Alt")altHeld.current=true;
    else if(key==="Escape"&&drag.current){cancelDrag();event.preventDefault?.();}
  };
  const onRootKeyUp=(event:KeyEvent)=>{if(keyboardKey(event)==="Alt")altHeld.current=false;};

  const canvasHandlers=useLocalPointer({
    onBegin:point=>{pressAt.current=point;},
    onMove:()=>{},
    onRelease:point=>{
      const start=pressAt.current;
      pressAt.current=null;
      if(!start||Math.hypot(point.x-start.x,point.y-start.y)>PEN_TAP_SLOP*2)return;
      const p=latest.current;
      const hit=hitPath(p.subpaths,point,PEN_INSERT_TOLERANCE,q=>toView(p.transform,q));
      if(hit&&hit.t>0.001&&hit.t<0.999){
        const intent=splitSegment(p.subpaths,hit.subpath,hit.segment,hit.t);
        store.setState({notice:undefined});
        p.onInsertNode(intent);
        p.onSelectionChange({subpath:intent.subpath,index:intent.index});
      }else if(p.selection)p.onSelectionChange(undefined);
    },
    onCancel:()=>{pressAt.current=null;},
  });

  const view=(q:Point)=>toView(transform,q);
  const accentLine=joinClasses(styled&&!accentColor&&"bg-accent");
  const outline=shown.flatMap((sp,si)=>Array.from({length:segmentCount(sp)},(_,s)=>{
    const pts=sampleSegment(segmentControls(sp,s)).map(view);
    return pts.slice(1).map((pt,i)=><LinePiece key={`o${si}-${s}-${i}`} from={pts[i]!} to={pt} thickness={1.5}
      className={accentLine} color={accentColor}/>);
  }));
  const selNode=selected?nodeAt(shown,selected):undefined;
  const handles=selected&&selNode?(["in","out"] as const).flatMap(side=>{
    const h=selNode[side];
    if(!h)return [];
    const at=view({x:selNode.x,y:selNode.y}),tip=view({x:selNode.x+h[0],y:selNode.y+h[1]});
    const target:Target={kind:"handle",ref:selected,side};
    return [<LinePiece key={"l"+side} from={at} to={tip} thickness={1} className={joinClasses(styled&&"bg-text-muted")}/>,
      <CanvasKnob key={"h"+side} at={tip} selected={false} styled={styled} zIndex={2}
        testID={"pen-handle-"+side}
        label={`${sideLabel(side)} of node ${selected.index+1}, ${Math.round(h[0]*10)/10} by ${Math.round(h[1]*10)/10}`}
        hint="Drag, or use arrow keys, to reshape the curve. Hold Alt to break a smooth node."
        onBegin={()=>begin(target)} onMove={dragTo} onRelease={release} onCancel={cancelDrag}
        onKeyDown={onKnobKey(target)}
        onAction={name=>{const d=ACTION_DELTA[name];if(d)nudge(target,d,false);}}
        actions={MOVE_ACTIONS}>
        <KnobGlyph shape="handle" selected={false} styled={styled} accentColor={accentColor}/>
      </CanvasKnob>];
  }):[];

  const selSub=selected?shown[selected.subpath]:undefined;
  return <View {...rest} {...{onKeyDown:onRootKey,onKeyUp:onRootKeyUp,className:joinClasses("gap-2",className)}}
    style={[{alignSelf:"flex-start",maxWidth:"100%"},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Applying path change"}</Text>:null}
    <View {...canvasHandlers} accessibilityLabel={label} testID="pen-canvas"
      {...{className:joinClasses("overflow-hidden",styled&&"rounded-control border border-border")}}
      // Canvas geometry stays left to right in RTL documents.
      style={{width,height,position:"relative",direction:"ltr",...NO_SELECT}}>
      <View pointerEvents="none" style={{position:"absolute",left:0,top:0,width,height}}>{children}</View>
      {outline}
      {handles}
      {shown.flatMap((sp,si)=>sp.nodes.map((node,i)=>{
        const ref={subpath:si,index:i};
        const target:Target={kind:"node",ref};
        const isSel=selected?.subpath===si&&selected.index===i;
        return <CanvasKnob key={`n${si}-${i}`} at={view(node)} selected={isSel} styled={styled}
          testID={`pen-node-${si}-${i}`}
          label={nodeAccessibilityLabel(shown,ref)}
          hint="Drag or use arrow keys to move. Delete removes it."
          onFocus={()=>{if(!isSel)latest.current.onSelectionChange(ref);}}
          onBegin={()=>begin(target)} onMove={dragTo} onRelease={release} onCancel={cancelDrag}
          onKeyDown={onKnobKey(target)}
          actions={NODE_ACTIONS}
          onAction={name=>{
            if(name==="activate"){latest.current.onSelectionChange(ref);return;}
            latest.current.onSelectionChange(ref);
            const d=ACTION_DELTA[name];
            if(d){nudge(target,d,false);return;}
            if(name==="insertAfter")insertAfter(ref);
            else if(name==="remove")removeSelected(ref);
            else if(name==="cycleKind"){
              const kinds=NODE_KINDS.map(k=>k.value);
              setKind(kinds[(kinds.indexOf(node.kind)+1)%kinds.length]!,ref);
            }
          }}>
          <KnobGlyph shape={node.kind} selected={isSel} styled={styled} accentColor={accentColor}/>
        </CanvasKnob>;
      }))}
    </View>
    {showCommands?<View accessibilityRole="toolbar" aria-label="Node commands"
      style={{flexDirection:"row",flexWrap:"wrap",gap:6,maxWidth:Math.max(width,320)}}>
      <View role="radiogroup" aria-label="Node kind" style={{flexDirection:"row",gap:6}}>
        {NODE_KINDS.map(k=><VectorButton key={k.value} role="radio" label={k.label} styled={styled}
          checked={selNode?.kind===k.value}
          reason={availabilityReason(kindAvailability(shown,selected))}
          onBlocked={block} onPress={()=>setKind(k.value)}/>)}
      </View>
      <VectorButton label="Add node" styled={styled} onBlocked={block} onPress={()=>insertAfter()}
        reason={availabilityReason(insertAfterAvailability(shown,selected))}/>
      <VectorButton label="Delete node" styled={styled} onBlocked={block} onPress={()=>removeSelected()}
        reason={availabilityReason(removeAvailability(shown,selected))}/>
      <VectorButton label={selSub?.closed?"Open path":"Close path"} styled={styled} onBlocked={block} onPress={toggleClosed}
        reason={availabilityReason(closeAvailability(shown,selected))}/>
    </View>:null}
    {showCommands?<NoticeLine text={notice??(selNode?`${nodeKindLabel(selNode.kind)} node selected. ${HINT}`:HINT)}
      styled={styled} testID="pen-notice"/>:null}
  </View>;
}

const ACTION_DELTA:Record<string,Point|undefined>={
  moveLeft:{x:-1,y:0},moveRight:{x:1,y:0},moveUp:{x:0,y:-1},moveDown:{x:0,y:1},
};
const MOVE_ACTIONS=[
  {name:"moveLeft",label:"Move left"},{name:"moveRight",label:"Move right"},
  {name:"moveUp",label:"Move up"},{name:"moveDown",label:"Move down"},
];
const NODE_ACTIONS=[
  {name:"activate",label:"Select"},...MOVE_ACTIONS,
  {name:"cycleKind",label:"Change node kind"},{name:"insertAfter",label:"Add node after"},{name:"remove",label:"Delete node"},
];

/** Node and handle marker: square corner, round smooth, diamond symmetric, small round handle; filled when selected. */
function KnobGlyph({shape,selected,styled,accentColor}:{shape:NodeKind|"handle";selected:boolean;styled:boolean;accentColor:string|undefined}){
  const size=shape==="handle"?PEN_HANDLE_SIZE:PEN_NODE_SIZE;
  const fill=selected?joinClasses(styled&&!accentColor&&"bg-accent"):joinClasses(styled&&"bg-surface-raised");
  return <View pointerEvents="none" {...{className:joinClasses(fill,styled&&!accentColor&&"border-accent")}}
    style={{width:size,height:size,borderWidth:2,...(accentColor?{borderColor:accentColor}:null),
      ...(selected&&accentColor?{backgroundColor:accentColor}:null),
      borderRadius:shape==="smooth"||shape==="handle"?size/2:shape==="corner"?1:0,
      transform:shape==="symmetric"?[{rotate:"45deg"}]:undefined}}/>;
}
