import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useLayoutEffect,useMemo,useRef} from "react";
import {Image,Platform,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {keyboardKey,type DragPoint,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {PanResponderDrag} from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {
  COMPARE_MODES,REFERENCE_SCALE,compareFrame,compareReason,normalizeFraction,resolveCompareSource,sideBySideDirection,
  splitFromDrag,splitFromKey,splitValueText,type CompareImage,type CompareMode,type CompareSource,
} from "./compare-model.ts";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode CanvasCompareView}. Mode, split and opacity are host state. */
export interface CanvasCompareViewProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The earlier image (a snapshot `flatten`) or a reference picture; `null` until the host has one. */
  before:CompareSource|null;
  /** The current image (the live `flatten`); `null` until the host has one. */
  after:CompareSource|null;
  /** @default "Before" */
  beforeLabel?:string;
  /** @default "After" */
  afterLabel?:string;
  mode:CompareMode;
  onModeChange:(mode:CompareMode)=>void;
  /** Share of the frame showing `before`, from the left, 0..1. Canvas geometry stays left-to-right in RTL. */
  split:number;
  /** Each divider move during a drag; a cancelled drag sends the original value once more. */
  onSplitPreview?:(split:number)=>void;
  /** Once per drag release or key press. */
  onSplitCommit:(split:number,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Opacity of `before` drawn over `after` in overlay mode, 0..1. */
  overlayOpacity:number;
  onOverlayOpacityPreview?:(opacity:number)=>void;
  /** Once per completed scrubber drag, nudge or typed value. */
  onOverlayOpacityCommit:(opacity:number,signal?:AbortSignal)=>void|Promise<unknown>;
  className?:string;
  unstyled?:boolean;
}

type Local={width:number;height:number;split:number|null;opacity:number|null};
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none"}:{}) as object;
const COL_RESIZE=(Platform.OS==="web"?{cursor:"col-resize"}:{}) as object;

/**
 * Before/after comparison of two canvas images (B-27): side by side (stacked
 * on narrow panes), split with a draggable divider (arrow keys, Page Up/Down,
 * Home/End; Escape cancels a drag), overlay with an opacity scrubber, and
 * reference, where the current image fills the view with the reference
 * pinned in a corner. Both images are fitted to the same frame so the split
 * and overlay line up.
 */
export function CanvasCompareView({scope='canvas-compare',revision=0,...props}:CanvasCompareViewProps){
 normalizeFraction(props.split);normalizeFraction(props.overlayOpacity);
 if(!COMPARE_MODES.some(o=>o.value===props.mode))throw new RangeError('Unknown comparison mode');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.mode]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <CanvasCompareViewBody key={owner} {...props} actionError={guard.error} busy={guard.pending}
  onModeChange={value=>guard.current()?.onModeChange(value)} onSplitPreview={value=>guard.current()?.onSplitPreview?.(value)} onOverlayOpacityPreview={value=>guard.current()?.onOverlayOpacityPreview?.(value)}
  onSplitCommit={value=>guard.run('split',(host,signal)=>host.onSplitCommit(value,signal))} onOverlayOpacityCommit={value=>guard.run('opacity',(host,signal)=>host.onOverlayOpacityCommit(value,signal))}/>;
}
function CanvasCompareViewBody({
  actionError=null,busy=false,disabledReason,before,after,beforeLabel="Before",afterLabel="After",mode,onModeChange,split,onSplitPreview,onSplitCommit,
  overlayOpacity,onOverlayOpacityPreview,onOverlayOpacityCommit,className,unstyled=false,style,...rest
}:CanvasCompareViewProps&{actionError?:string|null;busy?:boolean}){
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({width:0,height:0,split:null,opacity:null}));
  const store=local.current;
  const width=useStore(store,s=>s.width);
  const height=useStore(store,s=>s.height);
  const splitPreview=useStore(store,s=>s.split);
  const opacityPreview=useStore(store,s=>s.opacity);
  const beforeImage=useMemo(()=>before?resolveCompareSource(before):undefined,[before]);
  const afterImage=useMemo(()=>after?resolveCompareSource(after):undefined,[after]);
  const styled=!unstyled;
  const shownSplit=normalizeFraction(splitPreview??split);
  const shownOpacity=normalizeFraction(opacityPreview??overlayOpacity);
  const missing=compareReason(beforeImage,afterImage,beforeLabel,afterLabel);
  const latest=useRef({split,onSplitPreview,onSplitCommit});
  latest.current={split,onSplitPreview,onSplitCommit};
  const drag=useRef<{start:number;from?:DragPoint;frameWidth:number}|null>(null);
  const primary=afterImage??beforeImage;
  const frame=primary&&width>0&&height>0?compareFrame(primary,width,height):undefined;

  const cancelSplit=()=>{
    if(!drag.current&&store.getState().split===null)return;
    drag.current=null;
    store.setState({split:null});
    latest.current.onSplitPreview?.(latest.current.split);
  };
  useLayoutEffect(()=>{cancelSplit();store.setState({opacity:null});},[before,after,mode,busy,disabledReason]);
  const onDividerKey=(event:KeyEventLike&{shiftKey?:boolean;nativeEvent?:{shiftKey?:boolean};preventDefault?:()=>void})=>{
    const key=keyboardKey(event);
    if(key==="Escape"){cancelSplit();return;}
    if(busy||disabledReason!==undefined)return;
    const next=splitFromKey(latest.current.split,key,event.shiftKey??event.nativeEvent?.shiftKey??false);
    if(next===null)return;
    event.preventDefault?.();
    if(next!==latest.current.split)latest.current.onSplitCommit(next);
  };
  const step=(direction:-1|1)=>{
    const next=splitFromKey(latest.current.split,direction>0?"ArrowRight":"ArrowLeft",true);
    if(next!==null&&next!==latest.current.split)latest.current.onSplitCommit(next);
  };

  const picture=(image:CompareImage,box:{x:number;y:number;width:number;height:number},extra?:object)=>
    <Image source={{uri:image.uri}} accessibilityIgnoresInvertColors resizeMode="stretch"
      style={{position:"absolute",left:box.x,top:box.y,width:box.width,height:box.height,...extra}}/>;
  const chip=(text:string,position:object)=><View pointerEvents="none"
    {...{className:joinClasses(styled&&"rounded-control bg-surface-raised border border-border")}}
    style={{position:"absolute",paddingHorizontal:8,paddingVertical:3,...position}}>
    <Text {...{className:joinClasses(styled&&"text-text text-xs font-semibold")}}>{text}</Text>
  </View>;

  const stage=()=>{
    if(!frame||width<=0)return null;
    if(missing&&mode!=="reference"){
      return <View style={{flex:1,alignItems:"center",justifyContent:"center",padding:16}}>
        <Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{textAlign:"center"}}>{missing}</Text>
      </View>;
    }
    if(mode==="side-by-side"&&beforeImage&&afterImage){
      const direction=sideBySideDirection(width,height);
      const paneW=direction==="row"?(width-8)/2:width,paneH=direction==="row"?height:(height-8)/2;
      // The before pane is always on the left (or top): canvas geometry does not mirror in RTL.
      const pane=(image:CompareImage,text:string,offset:{x:number;y:number})=>{
        const f=compareFrame(image,paneW,paneH);
        return <View accessible accessibilityRole="image" accessibilityLabel={text+" image"}
          style={{position:"absolute",left:offset.x,top:offset.y,width:paneW,height:paneH,overflow:"hidden"}}>
          {picture(image,f)}
          {chip(text,{left:f.x+8,top:f.y+8})}
        </View>;
      };
      return <>
        {pane(beforeImage,beforeLabel,{x:0,y:0})}
        {pane(afterImage,afterLabel,direction==="row"?{x:paneW+8,y:0}:{x:0,y:paneH+8})}
      </>;
    }
    if(mode==="split"&&beforeImage&&afterImage){
      const cut=frame.width*shownSplit;
      return <>
        <View accessible accessibilityRole="image" accessibilityLabel={`${afterLabel} image with ${beforeLabel.toLowerCase()} on the left`}
          style={{position:"absolute",left:0,top:0,width,height}}>
          {picture(afterImage,frame)}
          <View style={{position:"absolute",left:frame.x,top:frame.y,width:cut,height:frame.height,overflow:"hidden"}}>
            {picture(beforeImage,{x:0,y:0,width:frame.width,height:frame.height})}
          </View>
          {cut>72?chip(beforeLabel,{left:frame.x+8,top:frame.y+8}):null}
          {frame.width-cut>72?chip(afterLabel,{right:width-frame.x-frame.width+8,top:frame.y+8}):null}
        </View>
        <PanResponderDrag
          onBegin={p=>{if(busy||disabledReason!==undefined)return;drag.current={start:latest.current.split,from:p,frameWidth:frame.width};store.setState({split:latest.current.split});}}
          onMove={(p,touches)=>{
            const d=drag.current;
            if(!d)return;
            if(touches!==1){cancelSplit();return;}
            const next=splitFromDrag(d.start,p.x-(d.from??p).x,d.frameWidth);
            if(next!==store.getState().split){store.setState({split:next});latest.current.onSplitPreview?.(next);}
          }}
          onRelease={()=>{
            const value=store.getState().split;
            const was=drag.current?.start;
            drag.current=null;
            store.setState({split:null});
            if(value!==null&&value!==was)latest.current.onSplitCommit(value);
          }}
          onCancel={cancelSplit}>
          <View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel="Split position"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shownSplit*100)}
            aria-valuetext={splitValueText(shownSplit,beforeLabel,afterLabel)}
            accessibilityHint="Drag or use the arrow keys to move the divider. Escape cancels a drag."
            accessibilityActions={[{name:"increment",label:"Move right"},{name:"decrement",label:"Move left"}]}
            onAccessibilityAction={e=>{
              if(e.nativeEvent.actionName==="increment")step(1);
              if(e.nativeEvent.actionName==="decrement")step(-1);
            }}
            {...{onKeyDown:onDividerKey,focusable:true,tabIndex:0,
              className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
            style={{position:"absolute",left:frame.x+cut-22,top:frame.y,width:44,height:frame.height,
              alignItems:"center",justifyContent:"center",...NO_SELECT,...COL_RESIZE}}>
            <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-surface-raised")}}
              style={{position:"absolute",top:0,bottom:0,width:2}}/>
            <View pointerEvents="none" {...{className:joinClasses(styled&&"bg-surface-raised border border-border")}}
              style={{width:28,height:44,borderRadius:forgeRadius.sm,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:3,
                boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}}>
              {[0,1].map(i=><View key={i} {...{className:joinClasses(styled&&"bg-text-muted")}} style={{width:1.5,height:14,borderRadius:forgeHairlineRadius.tick}}/>)}
            </View>
          </View>
        </PanResponderDrag>
      </>;
    }
    if(mode==="overlay"&&beforeImage&&afterImage){
      return <View accessible accessibilityRole="image"
        accessibilityLabel={`${beforeLabel} at ${Math.round(shownOpacity*100)}% over ${afterLabel.toLowerCase()}`}
        style={{position:"absolute",left:0,top:0,width,height}}>
        {picture(afterImage,frame)}
        {picture(beforeImage,frame,{opacity:shownOpacity})}
      </View>;
    }
    // Reference: the current image fills the view; the reference sits in the top end corner.
    const refW=Math.max(96,width*REFERENCE_SCALE);
    const ref=beforeImage?compareFrame(beforeImage,refW,refW):undefined;
    return <>
      {afterImage
        ?<View accessible accessibilityRole="image" accessibilityLabel={afterLabel+" image"} style={{position:"absolute",left:0,top:0,width,height}}>
          {picture(afterImage,frame)}
        </View>
        :<View style={{flex:1,alignItems:"center",justifyContent:"center"}}>
          <Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>{compareReason(true,false,beforeLabel,afterLabel)}</Text>
        </View>}
      {beforeImage&&ref?<View accessible accessibilityRole="image" accessibilityLabel={beforeLabel+" image"}
        {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised")}}
        style={{position:"absolute",top:12,end:12,width:ref.width+8,height:ref.height+8,padding:4,overflow:"hidden",
          boxShadow:"0 4px 12px rgba(0,0,0,0.18)"}}>
        <Image source={{uri:beforeImage.uri}} accessibilityIgnoresInvertColors resizeMode="stretch"
          style={{width:ref.width,height:ref.height}}/>
        {chip(beforeLabel,{start:8,bottom:8})}
      </View>:null}
    </>;
  };

  return <View {...rest} {...{className:joinClasses("min-w-0 gap-2",className)}} style={[{flex:1},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Applying comparison change"}</Text>:null}
    <SegmentedControl disabled={busy||disabledReason!==undefined} aria-label="Compare mode" options={COMPARE_MODES} value={mode} onChange={onModeChange} unstyled={unstyled}/>
    <View onLayout={e=>{
        const {width:w,height:h}=e.nativeEvent.layout;
        const s=store.getState();
        if(![w,h].every(Number.isFinite)||w<0||h<0)return;
        if(w!==s.width||h!==s.height){cancelSplit();store.setState({width:w,height:h});}
      }}
      {...{className:joinClasses("overflow-hidden",styled&&"rounded-card bg-surface-sunken border border-border")}}
      style={{flex:1,minHeight:200,...NO_SELECT}}>
      {primary?stage():<View style={{flex:1,alignItems:"center",justifyContent:"center",padding:16}}>
        <Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{textAlign:"center"}}>{missing}</Text>
      </View>}
    </View>
    {mode==="overlay"?<PrecisionScrubber label={beforeLabel+" opacity"} unit="%" min={0} max={100} step={1}
      value={Math.round(overlayOpacity*100)} disabled={missing!==undefined||busy||disabledReason!==undefined} unstyled={unstyled}
      onPreview={v=>{const o=normalizeFraction(v/100);store.setState({opacity:v===Math.round(overlayOpacity*100)?null:o});onOverlayOpacityPreview?.(o);}}
      onCommit={v=>{store.setState({opacity:null});const o=normalizeFraction(v/100);if(o!==overlayOpacity)onOverlayOpacityCommit(o);}}/>:null}
  </View>;
}
