import {forgeRadius} from "../radius.ts";
import {validateSlideSummary} from './slide-model.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useRef,useLayoutEffect,useMemo,type ReactNode} from "react";
import {PanResponder,Pressable,Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {officeKey,type OfficeKeyEvent} from "../office/office-controls.tsx";
import {SlideObjectView} from "./SlideThumbnail.tsx";
import {SLIDE_SNAP_POINTS,fitScale,nudge,objectLabel,resizeFromCorner,snapRect,stepRotation,type SnapGuide} from "./canvas-model.ts";
import {SLIDE_DEFAULT_SIZE,rgbaCss,type SlideObject,type SlideSize,type SlideSummary} from "./slide-model.ts";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode SlideCanvas}. Every edit is reported once, on release or commit; the slide is controlled. */
export interface SlideCanvasProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly slide:SlideSummary;
  readonly size?:SlideSize;
  readonly selectedObjectId?:string;
  /** `undefined` clears the selection (press on empty canvas, Escape). */
  readonly onSelectObject:(id:string|undefined)=>void;
  /** Called once per drag or nudge with the new top-left corner. Renders drag handling. */
  readonly onMoveObject?:((id:string,x:number,y:number)=>void|Promise<unknown>)|undefined;
  /** Called once per resize with the new size. Renders the corner handle. */
  readonly onResizeObject?:((id:string,w:number,h:number)=>void|Promise<unknown>)|undefined;
  /** Called with absolute degrees (`[` and `]` step 15°). */
  readonly onRotateObject?:((id:string,degrees:number)=>void|Promise<unknown>)|undefined;
  /** Commits edited text of a text box. Double press or Enter starts editing. */
  readonly onSetText?:((id:string,text:string)=>void|Promise<unknown>)|undefined;
  readonly onRemoveObject?:((id:string)=>void|Promise<unknown>)|undefined;
  /** Snap to slide edges and center and to other objects. @default true */
  readonly snap?:boolean;
  readonly renderImage?:(src:string,object:SlideObject)=>ReactNode;
  /** @default "Slide" */
  readonly label?:string;
  disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Preview={id:string;x:number;y:number;w:number;h:number;guides:SnapGuide[]};
type Local={width:number;height:number;preview:Preview|null;editing:{id:string;draft:string}|null};

/**
 * Editable slide (J-05): objects drawn to scale, press to select, drag to
 * move with snapping guides, corner handle to resize (Shift keeps the
 * ratio on web), arrows to nudge (Shift for 10), `[`/`]` to rotate, Delete to
 * remove, double press to edit text. A drag the system cancels restores the
 * object and reports nothing.
 *
 * The slide is document geometry, so it is never mirrored in RTL layouts:
 * drags, the resize corner and arrow keys move objects in slide space.
 */
export function SlideCanvas({scope='slide-canvas',revision=0,...props}:SlideCanvasProps){
 validateSlideSummary(props.slide);const identity=JSON.stringify([...controlIdentity(scope,revision),props.slide.id]),owner=JSON.stringify([identity,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <SlideCanvasBody key={identity} {...props} boundary={owner} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
 onSelectObject={id=>{const h=guard.current();if(h&&(id===undefined||h.slide.objects.some(o=>o.id===id)))h.onSelectObject(id);}}
 onMoveObject={props.onMoveObject?(id,x,y)=>guard.run('move',h=>h.slide.objects.some(o=>o.id===id)?h.onMoveObject?.(id,x,y):undefined):undefined}
 onResizeObject={props.onResizeObject?(id,w,h)=>guard.run('resize',host=>host.slide.objects.some(o=>o.id===id)?host.onResizeObject?.(id,w,h):undefined):undefined}
 onRotateObject={props.onRotateObject?(id,degrees)=>guard.run('rotate',h=>h.slide.objects.some(o=>o.id===id)?h.onRotateObject?.(id,degrees):undefined):undefined}
 onRemoveObject={props.onRemoveObject?id=>guard.run('remove',h=>h.slide.objects.some(o=>o.id===id)?h.onRemoveObject?.(id):undefined):undefined}
 onSetText={props.onSetText?async(id,text)=>{const ok=await guard.run('text',h=>{if(!h.slide.objects.some(o=>o.id===id&&o.kind==='text'))throw new Error('This text object is unavailable');return h.onSetText?.(id,text);});if(ok!==true)throw new Error('Text was not saved; the draft is retained');}:undefined}/>;
}
function SlideCanvasBody({boundary,actionError,disabledReason,disabled=false,

  slide,size=SLIDE_DEFAULT_SIZE,selectedObjectId,onSelectObject,onMoveObject,onResizeObject,onRotateObject,onSetText,
  onRemoveObject,snap=true,renderImage,label="Slide",className,unstyled=false,...rest
}:SlideCanvasProps&{boundary:string;actionError?:string|null}){
  const styled=!unstyled;
  const [local,store]=useLocalStore<Local>(()=>({width:0,height:0,preview:null,editing:null}));
  const scale=fitScale(size,local.width,local.height>0?local.height:Infinity);
  const latest=useRef({slide,size,scale,snap,selectedObjectId,onSelectObject,onMoveObject,onResizeObject,disabled});
  useLayoutEffect(()=>{latest.current={slide,size,scale,snap,selectedObjectId,onSelectObject,onMoveObject,onResizeObject,disabled};});
  const start=useRef<SlideObject|null>(null);
  // Page position where the drag began. The responder is granted only after 3pt of travel, and
  // some hosts restart gestureState.dx at the grant, so distance is measured from the page instead.
  const anchor=useRef({x:0,y:0});
  const selected=slide.objects.find(o=>o.id===selectedObjectId);

  const begin=()=>{
    const p=latest.current;
    const o=p.slide.objects.find(x=>x.id===p.selectedObjectId);
    start.current=o??null;
    if(o)store.set(s=>({...s,preview:{id:o.id,x:o.x,y:o.y,w:o.w,h:o.h,guides:[]}}));
  };
  const cancel=()=>{start.current=null;store.set(s=>({...s,preview:null}));};
  const objectSignature=useMemo(()=>JSON.stringify(slide.objects),[slide.objects]);
  useLayoutEffect(()=>{cancel();},[boundary,objectSignature,scale,size.width,size.height,selectedObjectId]);
  const movePan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!movePan.current)movePan.current=PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    // Capture phase: the object's Pressable already holds the press, and a drag past 3pt is a move, not a tap.
    onMoveShouldSetPanResponderCapture:(e,g)=>{
      const claim=!latest.current.disabled&&latest.current.onMoveObject!==undefined&&latest.current.selectedObjectId!==undefined&&Math.hypot(g.dx,g.dy)>3;
      if(claim)anchor.current={x:e.nativeEvent.pageX-g.dx,y:e.nativeEvent.pageY-g.dy};
      return claim;
    },
    onPanResponderGrant:begin,
    onPanResponderMove:(e,g)=>{
      if(g.numberActiveTouches>1){cancel();return;}
      const p=latest.current,o=start.current;
      if(!o||p.scale<=0)return;
      const dx=e.nativeEvent.pageX-anchor.current.x,dy=e.nativeEvent.pageY-anchor.current.y;
      const raw={x:o.x+dx/p.scale,y:o.y+dy/p.scale,w:o.w,h:o.h};
      const others=p.slide.objects.filter(x=>x.id!==o.id);
      const s=p.snap?snapRect(raw,others,p.size,SLIDE_SNAP_POINTS/p.scale):{x:raw.x,y:raw.y,guides:[]};
      store.set(st=>({...st,preview:{id:o.id,x:round(s.x),y:round(s.y),w:o.w,h:o.h,guides:s.guides}}));
    },
    onPanResponderRelease:e=>{
      const o=start.current,p=latest.current;if(!o||p.scale<=0){cancel();return;}
      const raw={x:o.x+(e.nativeEvent.pageX-anchor.current.x)/p.scale,y:o.y+(e.nativeEvent.pageY-anchor.current.y)/p.scale,w:o.w,h:o.h},next=p.snap?snapRect(raw,p.slide.objects.filter(x=>x.id!==o.id),p.size,SLIDE_SNAP_POINTS/p.scale):raw;
      cancel();if(round(next.x)!==o.x||round(next.y)!==o.y)void p.onMoveObject?.(o.id,round(next.x),round(next.y));
    },
    onPanResponderTerminate:cancel,
    onPanResponderTerminationRequest:()=>false,
  });
  const sizePan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!sizePan.current)sizePan.current=PanResponder.create({
    onStartShouldSetPanResponder:()=>!latest.current.disabled&&latest.current.onResizeObject!==undefined,
    onMoveShouldSetPanResponder:()=>!latest.current.disabled&&latest.current.onResizeObject!==undefined,
    onPanResponderGrant:begin,
    onPanResponderMove:(e,g)=>{
      if(g.numberActiveTouches>1){cancel();return;}
      const p=latest.current,o=start.current;
      if(!o||p.scale<=0)return;
      const keep=(e.nativeEvent as unknown as {shiftKey?:boolean}).shiftKey===true;
      const r=resizeFromCorner(o,g.dx/p.scale,g.dy/p.scale,keep);
      store.set(st=>({...st,preview:{id:o.id,x:o.x,y:o.y,w:r.w,h:r.h,guides:[]}}));
    },
    onPanResponderRelease:(e,g)=>{
      const o=start.current,p=latest.current;if(!o||p.scale<=0){cancel();return;}
      const keep=(e.nativeEvent as unknown as {shiftKey?:boolean}).shiftKey===true,next=resizeFromCorner(o,g.dx/p.scale,g.dy/p.scale,keep);cancel();
      if(next.w!==o.w||next.h!==o.h)void p.onResizeObject?.(o.id,next.w,next.h);
    },
    onPanResponderTerminate:cancel,
    onPanResponderTerminationRequest:()=>false,
  });

  const startEditing=(o:SlideObject)=>{if(o.kind==="text"&&onSetText)store.set(s=>({...s,editing:{id:o.id,draft:o.text??""}}));};
  const savingText=useRef(false);
  const finishEditing=async(commit:boolean)=>{
    const ed=store.get().editing;if(!ed||savingText.current)return;
    if(!commit){store.set(s=>({...s,editing:null}));return;}
    const o=slide.objects.find(x=>x.id===ed.id);if(!o||ed.draft===(o.text??'')){store.set(s=>({...s,editing:null}));return;}
    savingText.current=true;try{await onSetText?.(ed.id,ed.draft);if(store.get().editing?.id===ed.id&&store.get().editing?.draft===ed.draft)store.set(s=>({...s,editing:null}));}catch{/* Scoped owner shows the failure; preserve this draft. */}finally{savingText.current=false;}
  };
  const onKeyDown=(e:OfficeKeyEvent)=>{
    if(local.editing||disabled)return;
    const {key,shift}=officeKey(e);
    const o=selected;
    let handled=true;
    const step=nudge(key,shift);
    if(key==="Escape")onSelectObject(undefined);
    else if(!o)handled=false;
    else if(step&&onMoveObject)void onMoveObject(o.id,round(o.x+step.dx),round(o.y+step.dy));
    else if((key==="["||key==="]")&&onRotateObject)void onRotateObject(o.id,stepRotation(o.rotation,key==="]"?1:-1));
    else if((key==="Delete"||key==="Backspace")&&onRemoveObject)void onRemoveObject(o.id);
    else if((key==="Enter"||key==="F2")&&o.kind==="text"&&onSetText)startEditing(o);
    else handled=false;
    if(handled)(e as unknown as {preventDefault?:()=>void}).preventDefault?.();
  };

  const width=size.width*scale,height=size.height*scale;
  const pv=local.preview;
  return <View {...rest} {...{className:joinClasses("min-w-0",className)}}
    onLayout={e=>{const l=e.nativeEvent.layout;store.set(s=>s.width===l.width&&s.height===l.height?s:{...s,width:l.width,height:l.height});}}
    style={[{alignItems:"center",justifyContent:"center"},rest.style as object]}>
    {scale>0?<View accessibilityLabel={label} {...{role:"group",onKeyDown,tabIndex:0,
      className:joinClasses(styled&&"border border-border focus-visible:ring-2 focus-visible:ring-focus",styled&&!slide.background&&"bg-surface-raised")}}
      style={{width,height,overflow:"hidden",...(slide.background?{backgroundColor:rgbaCss(slide.background)}:null)}}>
      <Pressable accessible={false} importantForAccessibility="no" onPress={()=>onSelectObject(undefined)}
        style={{position:"absolute",left:0,top:0,right:0,bottom:0}}/>
      {slide.objects.map(o=>{
        const shown=pv?.id===o.id?{...o,x:pv.x,y:pv.y,w:pv.w,h:pv.h}:o;
        const on=o.id===selectedObjectId;
        const editing=local.editing?.id===o.id;
        const actions=[
          {name:"activate"},
          ...(on&&onRemoveObject?[{name:"remove",label:"Delete"}]:[]),
          ...(on&&o.kind==="text"&&onSetText?[{name:"edit",label:"Edit text"}]:[]),
          ...(on&&onRotateObject?[{name:"rotateLeft",label:"Rotate left 15 degrees"},{name:"rotateRight",label:"Rotate right 15 degrees"}]:[]),
        ];
        return <View key={o.id} {...(on?movePan.current!.panHandlers:{})}
          style={{position:"absolute",left:0,top:0,width,height}} pointerEvents="box-none">
          <SlideObjectView object={shown} scale={scale} renderImage={renderImage} styled={styled}/>
          <Pressable accessibilityRole="button" accessibilityLabel={objectLabel(shown)} accessibilityState={{selected:on}}
            accessibilityActions={actions}
            onAccessibilityAction={e=>{
              const a=e.nativeEvent.actionName;
              if(a==="activate")onSelectObject(o.id);
              else if(a==="remove")void onRemoveObject?.(o.id);
              else if(a==="edit")startEditing(o);
              else if(a==="rotateLeft"||a==="rotateRight")void onRotateObject?.(o.id,stepRotation(o.rotation,a==="rotateRight"?1:-1));
            }}
            onPress={()=>onSelectObject(o.id)} {...{onDoubleClick:()=>startEditing(o)}} onLongPress={()=>{onSelectObject(o.id);startEditing(o);}}
            {...{className:joinClasses(styled&&"border",styled&&(on?"border-focus":"border-transparent"))}}
            style={{position:"absolute",left:shown.x*scale-1,top:shown.y*scale-1,width:shown.w*scale+2,height:shown.h*scale+2,
              transform:shown.rotation?[{rotate:shown.rotation+"deg"}]:undefined}}/>
          {editing?<TextInput autoFocus multiline editable={!disabled} maxLength={1048576} value={local.editing!.draft} accessibilityLabel="Text box contents"
            onChangeText={draft=>store.set(s=>({...s,editing:{id:o.id,draft}}))}
            onBlur={()=>finishEditing(true)}
            onKeyPress={e=>{if(e.nativeEvent.key==="Escape")finishEditing(false);}}
            {...{className:joinClasses(styled&&"border-2 border-focus bg-surface-raised text-text")}}
            style={{position:"absolute",left:o.x*scale,top:o.y*scale,width:Math.max(o.w*scale,120),minHeight:Math.max(o.h*scale,44),
              fontSize:Math.max(14,(o.fontSize??18)*scale),padding:4}}/>:null}
          {on&&onResizeObject&&!editing?<View {...sizePan.current!.panHandlers} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={{position:"absolute",left:(shown.x+shown.w)*scale-22,top:(shown.y+shown.h)*scale-22,width:44,height:44,
              alignItems:"center",justifyContent:"center"}}>
            <View {...{className:joinClasses(styled&&"border-2 border-focus bg-surface-raised")}} style={{width:12,height:12,borderRadius:forgeRadius.sm}}/>
          </View>:null}
        </View>;
      })}
      {pv?.guides.map((g,i)=><View key={i} pointerEvents="none" {...{className:joinClasses(styled&&"bg-accent")}}
        style={g.axis==="x"?{position:"absolute",left:g.at*scale,top:0,bottom:0,width:1}:{position:"absolute",top:g.at*scale,left:0,right:0,height:1}}/>)}
      {slide.objects.length===0?<View pointerEvents="none" style={{position:"absolute",left:0,right:0,top:0,bottom:0,alignItems:"center",justifyContent:"center"}}>
        <Text {...{className:joinClasses(styled&&"text-text-muted")}}>Empty slide. Add text, a shape or an image.</Text>
      </View>:null}
    </View>:null}<ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/>
  </View>;
}

function round(v:number){return Math.round(v*100)/100;}
