import {validateSlideSummary} from './slide-model.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useRef,useLayoutEffect,type ReactNode} from "react";
import {I18nManager,PanResponder,Pressable,FlatList,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {dragTargetIndex} from "../layers/layer-model.ts";
import {OFFICE_TOUCH_TARGET,PlusGlyph,officeKey,type OfficeKeyEvent} from "../office/office-controls.tsx";
import {SlideThumbnail} from "./SlideThumbnail.tsx";
import {SLIDE_DEFAULT_SIZE,slideLabel,type SlideObject,type SlideSize,type SlideSummary} from "./slide-model.ts";

/** Props for {@linkcode SlideFilmstrip}. Each action renders only when its callback is passed. */
export interface SlideFilmstripProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly slides:readonly SlideSummary[];
  readonly sections?:readonly {id:string;label:string;startSlideId:string}[];
  readonly viewportHeight?:number;
  readonly selectedId?:string;
  readonly onSelect:(id:string)=>void;
  /** Moves a slide to `toIndex` (0-based). Drag, Alt+Up/Down and screen-reader actions call it once per move. */
  readonly onMove?:(id:string,toIndex:number)=>void|Promise<unknown>;
  /** Adds a slide. Where it goes is the host engine's call (Pitch appends). */
  readonly onAdd?:()=>void|Promise<unknown>;
  /** Removes a slide. Not offered when only one slide is left. */
  readonly onRemove?:(id:string)=>void|Promise<unknown>;
  readonly size?:SlideSize;
  readonly renderImage?:(src:string,object:SlideObject)=>ReactNode;
  /** Thumbnail width in points. @default 136 */
  readonly thumbnailWidth?:number;
  /**
   * `horizontal` lays slides out in a row for phones and short panes; drag and
   * Alt+Left/Right then reorder along it.
   * @default "vertical"
   */
  readonly orientation?:"vertical"|"horizontal";
  disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Drag={id:string;from:number;to:number;dy:number};

/**
 * Vertical slide filmstrip (J-01): numbered thumbnails drawn from the slide's
 * objects, selection, reorder by the grip, Alt+Up/Down or screen-reader
 * actions, add, and remove (Delete key or action). A cancelled drag never
 * moves anything.
 */
export function SlideFilmstrip({scope='SlideFilmstrip',revision=0,...props}:SlideFilmstripProps){
 if(props.slides.length>10000||props.slides.reduce((n,s)=>n+s.objects.length,0)>100000||new Set(props.slides.map(s=>s.id)).size!==props.slides.length)throw new RangeError('Invalid slide filmstrip');props.slides.forEach(validateSlideSummary);
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=useEditorBoundary([JSON.stringify([identity,props.disabled,props.disabledReason,props.slides.map(s=>s.id)])]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <SlideFilmstripBody key={identity} {...props} boundary={owner} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onMove={props.onMove?(...args:Parameters<NonNullable<SlideFilmstripProps['onMove']>>)=>guard.run('onMove',h=>h.onMove?.(...args)):undefined}
  onAdd={props.onAdd?(...args:Parameters<NonNullable<SlideFilmstripProps['onAdd']>>)=>guard.run('onAdd',h=>h.onAdd?.(...args)):undefined}
  onRemove={props.onRemove?(...args:Parameters<NonNullable<SlideFilmstripProps['onRemove']>>)=>guard.run('onRemove',h=>h.onRemove?.(...args)):undefined}
  onSelect={(...args:Parameters<NonNullable<SlideFilmstripProps['onSelect']>>)=>{guard.current()?.onSelect?.(...args);}}
 />;
}
function SlideFilmstripBody({boundary,actionError,disabledReason,disabled=false,
  slides,selectedId,onSelect,onMove,onAdd,onRemove,sections=[],viewportHeight=480,size=SLIDE_DEFAULT_SIZE,renderImage,thumbnailWidth=136,orientation="vertical",
  className,unstyled=false,...rest
}:SlideFilmstripProps&{boundary:string;actionError?:string|null}){
  const styled=!unstyled;
  const [state,store]=useLocalStore<{drag:Drag|null}>(()=>({drag:null}));
  useLayoutEffect(()=>{store.set({drag:null});},[boundary,thumbnailWidth,orientation,size.width,size.height,disabled]);
  if(sections.length>1024||new Set(sections.map(s=>s.id)).size!==sections.length||new Set(sections.map(s=>s.startSlideId)).size!==sections.length||sections.some(s=>!s.label.trim()||s.label.length>1024||!slides.some(slide=>slide.id===s.startSlideId))||!Number.isFinite(viewportHeight)||viewportHeight<88||viewportHeight>4096)throw new RangeError('Invalid slide sections or viewport');
  const horizontal=orientation==="horizontal";
  // Each slide's extent along the strip: what a drag distance is divided by to find the drop index.
  const rowHeight=(horizontal?thumbnailWidth+40:thumbnailWidth*size.height/size.width+16)+(sections.length?32:0);
  return <View {...rest} accessibilityLabel="Slides" {...{className:joinClasses("min-w-0",styled&&"bg-surface-sunken",className)}}
    style={[{gap:8,flexDirection:horizontal?"row":"column",alignItems:horizontal?"center":"stretch"},rest.style as object]}>
    <FlatList data={slides} keyExtractor={slide=>slide.id} horizontal={horizontal} scrollEnabled={state.drag===null} style={{flexShrink:1,maxHeight:viewportHeight}}
      initialNumToRender={6} windowSize={5} removeClippedSubviews={false} getItemLayout={(_data,index)=>({length:rowHeight,offset:rowHeight*index,index})} extraData={[state.drag,selectedId,disabled,sections]}
      contentContainerStyle={horizontal?{paddingHorizontal:4}:{paddingVertical:4}} renderItem={({item:slide,index})=><FilmstripRow key={slide.id} disabled={disabled} sectionLabel={sections.find(s=>s.startSlideId===slide.id)?.label} reserveSection={sections.length>0} slide={slide} index={index} count={slides.length}
        selected={slide.id===selectedId} drag={state.drag?.id===slide.id?state.drag:null} store={store} rowHeight={rowHeight}
        thumbnailWidth={thumbnailWidth} size={size} renderImage={renderImage} styled={styled} horizontal={horizontal}
        onSelect={onSelect} onMove={onMove} onRemove={onRemove}/>}/>

    {onAdd?<Pressable accessibilityRole="button" accessibilityLabel="New slide" onPress={()=>void onAdd()}
      {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus")}}
      style={{minHeight:OFFICE_TOUCH_TARGET,minWidth:OFFICE_TOUCH_TARGET,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,
        marginHorizontal:horizontal?4:8,paddingHorizontal:horizontal?10:0}}>
      <PlusGlyph styled={styled} size={12}/>
      {horizontal?null:<Text {...{className:joinClasses(styled&&"text-text text-sm")}}>New slide</Text>}
    </Pressable>:null}
  <ErrorMessage message={actionError??disabledReason} unstyled={unstyled}/></View>;
}

type RowProps={
  disabled:boolean;sectionLabel?:string;reserveSection:boolean;slide:SlideSummary;index:number;count:number;selected:boolean;drag:Drag|null;
  store:{get:()=>{drag:Drag|null};set:(v:{drag:Drag|null})=>void};rowHeight:number;thumbnailWidth:number;size:SlideSize;
  renderImage:SlideFilmstripProps["renderImage"];styled:boolean;horizontal:boolean;
}&Pick<SlideFilmstripProps,"onSelect"|"onMove"|"onRemove">;

function FilmstripRow(props:RowProps){
  const {slide,index,count,selected,drag,store,rowHeight,thumbnailWidth,size,renderImage,styled,horizontal,disabled,sectionLabel,reserveSection}=props;
  const latest=useRef(props);
  useLayoutEffect(()=>{latest.current=props;});
  const move=(to:number)=>{
    const p=latest.current;
    if(p.disabled||!p.onMove||to<0||to>=p.count||to===p.index)return;
    void p.onMove(p.slide.id,to);
  };
  const removable=props.onRemove!==undefined&&count>1;
  const remove=()=>{const p=latest.current;if(!p.disabled&&p.onRemove&&p.count>1)void p.onRemove(p.slide.id);};
  const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  if(!pan.current)pan.current=PanResponder.create({
    onStartShouldSetPanResponder:()=>!latest.current.disabled&&latest.current.onMove!==undefined,
    onMoveShouldSetPanResponder:()=>!latest.current.disabled&&latest.current.onMove!==undefined,
    onPanResponderGrant:()=>{const p=latest.current;store.set({drag:{id:p.slide.id,from:p.index,to:p.index,dy:0}});},
    onPanResponderMove:(_e,g)=>{
      if(g.numberActiveTouches>1){store.set({drag:null});return;}
      const p=latest.current;
      const d=store.get().drag;
      if(d?.id!==p.slide.id)return;
      // Along a horizontal strip the start edge is the right edge in RTL.
      const along=p.horizontal?(I18nManager.isRTL?-g.dx:g.dx):g.dy;
      store.set({drag:{...d,dy:along,to:dragTargetIndex(d.from,along,p.rowHeight,p.count)}});
    },
    onPanResponderRelease:(_e,g)=>{
      const p=latest.current,d=store.get().drag;store.set({drag:null});
      if(d&&d.id===p.slide.id){const along=p.horizontal?(I18nManager.isRTL?-g.dx:g.dx):g.dy,to=dragTargetIndex(d.from,along,p.rowHeight,p.count);if(to!==d.from)move(to);}
    },
    onPanResponderTerminate:()=>store.set({drag:null}),
    onPanResponderTerminationRequest:()=>false,
  });
  const onKeyDown=(e:OfficeKeyEvent)=>{
    const {key,alt}=officeKey(e);
    let handled=true;
    const back=horizontal?(I18nManager.isRTL?"ArrowRight":"ArrowLeft"):"ArrowUp";
    const forward=horizontal?(I18nManager.isRTL?"ArrowLeft":"ArrowRight"):"ArrowDown";
    if(alt&&key===back)move(index-1);
    else if(alt&&key===forward)move(index+1);
    else if((key==="Delete"||key==="Backspace")&&removable)remove();
    else handled=false;
    if(handled)(e as unknown as {preventDefault?:()=>void}).preventDefault?.();
  };
  const actions=[
    {name:"activate"},
    ...(props.onMove&&index>0?[{name:"moveUp",label:"Move earlier"}]:[]),
    ...(props.onMove&&index<count-1?[{name:"moveDown",label:"Move later"}]:[]),
    ...(removable?[{name:"remove",label:"Delete slide"}]:[]),
  ];
  const shift=drag?(horizontal?[{translateX:I18nManager.isRTL?-drag.dy:drag.dy}]:[{translateY:drag.dy}]):undefined;
  return <View style={{...(horizontal?{width:rowHeight,flexDirection:"column-reverse",paddingVertical:4}:{height:rowHeight,flexDirection:"row",paddingHorizontal:4}),
    alignItems:"center",zIndex:drag?1:0,transform:shift,...(reserveSection?{paddingTop:32}:{})}}>
    {sectionLabel?<Text accessibilityRole="header" {...{className:joinClasses(styled&&"text-text font-semibold")}} style={{position:"absolute",top:0,start:8,end:8,height:28}}>{sectionLabel}</Text>:null}
    <View style={{...(horizontal?{flexDirection:"row",height:OFFICE_TOUCH_TARGET}:{width:44}),alignItems:"center",gap:6}}>
      <Text {...{className:joinClasses(styled&&(selected?"text-text":"text-text-muted"))}}
        style={{fontVariant:["tabular-nums"],fontSize:12,fontWeight:selected?"700":"400"}}>{index+1}</Text>
      {props.onMove?<View {...pan.current.panHandlers} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
        style={{width:OFFICE_TOUCH_TARGET,height:OFFICE_TOUCH_TARGET,alignItems:"center",justifyContent:"center",gap:3}}>
        {[0,1,2].map(i=><View key={i} {...{className:joinClasses(styled&&"bg-text-muted")}} style={{width:12,height:2,borderRadius:1}}/>)}
      </View>:null}
    </View>
    <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={slideLabel(slide,index,count)} accessibilityState={{selected,disabled}}
      accessibilityActions={actions}
      onAccessibilityAction={e=>{
        const a=e.nativeEvent.actionName;
        if(a==="activate")latest.current.onSelect(slide.id);
        else if(a==="moveUp")move(index-1);
        else if(a==="moveDown")move(index+1);
        else if(a==="remove")remove();
      }}
      // React Native Web drops `selected` on buttons; aria-current marks the slide being edited there.
      onPress={()=>latest.current.onSelect(slide.id)} {...{onKeyDown,"aria-current":selected?"true":undefined}}
      {...{className:joinClasses(styled&&"rounded-control border-2 focus-visible:ring-2 focus-visible:ring-focus",
        styled&&(selected||drag?"border-accent":"border-border"))}}
      style={{padding:2,overflow:"hidden"}}>
      <SlideThumbnail slide={slide} width={thumbnailWidth} size={size} renderImage={renderImage} styled={styled}/>
    </Pressable>
  </View>;
}
