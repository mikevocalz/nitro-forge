import {useEffect,useLayoutEffect,useRef,type ReactNode} from "react";
import {I18nManager,Platform,PanResponder,Pressable,ScrollView,Text,TextInput,View,type PressableProps,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Button} from '@nyc-tron/ui/components/Button';
import {nodeIsRTL} from '@nyc-tron/ui/components/shell/shell-keys';
import {MenuButton} from '@nyc-tron/ui/components/shell/MenuButton';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {flattenLayerTree,validateLayerTreeMove} from './layer-tree-model.ts';
import {cancelPreview} from "../cancel-preview.ts";
import {exact} from "../exact-optional.ts";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {AnchoredPopover} from "@nyc-tron/ui/components/overlays/AnchoredPopover";
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {ClipIndicator} from "./ClippingMaskControls.tsx";
import {
 LAYER_NAME_MIN_WIDTH,LAYER_OPACITY_READOUT_WIDTH,LAYER_OPACITY_SLIDER_WIDTH,LAYER_THUMBNAIL_SIZE,LAYER_TOUCH_TARGET,
 dragTargetIndex,formatOpacity,layerAccessibilityLabel,layerDetail,layerOpacityMode,normalizeOpacity,opacityFromDrag,
 resolveRename,stepOpacity,validateLayers,type LayerOpacityMode,type LayerRow,type LayerThumbnail,
} from "./layer-model.ts";

type OpacityPreview={id:string;value:number};
type Drag={id:string;from:number;to:number;dy:number};
type Rename={id:string;draft:string};
type Local={opacity:OpacityPreview|null;drag:Drag|null;rename:Rename|null;width:number|undefined;editing:string|null};
type KeyEvent=Parameters<NonNullable<PressableProps["onKeyDown"]>>[0];

/** Props for {@linkcode LayerStack}. Every layer value is controlled by the app. */
export interface LayerStackProps extends Omit<ViewProps,"children">{
 /** Document boundary. Reusing layer IDs across documents must change this scope. */
 scope?:string;revision?:string|number;disabled?:boolean;
 expandedIds?:readonly string[];onExpandedChange?:(ids:readonly string[])=>void;
 onToggleLocked?:(id:string)=>void|Promise<unknown>;
 /** Sibling insertion index after removing the moved layer. Nested stacks use this callback. */
 onReparent?:(id:string,parentId:string|null,toIndex:number)=>void|Promise<unknown>;
 /** Layers top to bottom: index 0 is the topmost layer and the first row. */
 layers:readonly LayerRow[];
 /** Id of the selected layer, or `undefined` for no selection. */
 selectedId?:string;
 /** Called when a row is tapped or activated by a screen reader. */
 onSelect:(id:string)=>void;
 /** Called when the visibility control is toggled. */
 onToggleVisible:(id:string)=>void;
 /**
  * Called on every opacity change during a drag so the compositor can draw a
  * live preview. A cancelled drag calls it once more with the original value.
  */
 onOpacityPreview?:((id:string,value:number)=>void)|undefined;
 /** Called once per completed opacity drag or screen-reader step, never per frame. */
 onOpacityCommit:(id:string,value:number)=>void|Promise<unknown>;
 /** Called once when a drag or move action lands a layer on a new index (0 = top). */
 onMove:(id:string,toIndex:number)=>void|Promise<unknown>;
 /** Called with the trimmed name when a rename is submitted. Blank or unchanged names are dropped. */
 onRename:(id:string,name:string)=>void|Promise<unknown>;
 /**
  * Called when a row's remove button, its "Remove" screen-reader action, or
  * Delete/Backspace on the focused row asks to delete an unlocked layer. There
  * is no confirmation step: the host applies removal as an engine operation
  * that its undo restores (`removeLayer` in `layer-model` applies it). The remove control
  * renders only when this is passed.
  */
 onRemove?:(id:string)=>void|Promise<unknown>;
 /**
  * Fixed row height in points. Values below 44 are raised to 44.
  * @default 56
  */
 rowHeight?:number;
 /**
  * Screen-reader label for the list.
  * @default "Layers"
  */
 label?:string;
 /** @default "No layers" */
 emptyLabel?:string;
 /** Optional override; defaults to the theme's accent token. */
 accentColor?:string;
 /**
  * How rows show opacity. `auto` measures the stack and keeps the inline
  * slider only while a whole row fits beside it (`layerRowMinWidth` in
  * `layer-model`); narrower stacks get a percentage readout
  * that opens a {@linkcode PrecisionScrubber} popover, so the name and the
  * remove button never clip. `slider` and `readout` force one presentation.
  * @default "auto"
  */
 opacityControl?:"auto"|LayerOpacityMode;
 className?:string;
 unstyled?:boolean;
}

/**
 * Controlled layer list for editors. Visibility, opacity, order, names and
 * selection all live in the app; the component holds only gesture previews.
 */
export function LayerStack({scope='layers',revision=0,disabled=false,expandedIds=[],onExpandedChange,onToggleLocked,onReparent,...props}:LayerStackProps){
 const rows=flattenLayerTree(props.layers,expandedIds),nested=props.layers.some(layer=>layer.parentId!=null),controls=nested||!!onToggleLocked||!!onExpandedChange;
 if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512||!Number.isFinite(props.rowHeight??56)||(props.rowHeight??56)>1000)throw new RangeError('Invalid layer stack identity or row size');
 const boundary=JSON.stringify([scope,revision,disabled,props.rowHeight,props.layers.map(layer=>[layer.id,layer.parentId,layer.locked]),expandedIds]);
 const viewIdentity=JSON.stringify([scope,revision,disabled,props.rowHeight,props.layers.map(layer=>[layer.id,layer.parentId,layer.locked]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
 const action=useOwnedAction(boundary),busy=action.pending!==null,request=useRef<symbol|null>(null);
 useLayoutEffect(()=>{request.current=null;},[boundary]);
 const committed=useRef<null|{boundary:string;props:typeof props;disabled:boolean;busy:boolean;onExpandedChange:typeof onExpandedChange;onToggleLocked:typeof onToggleLocked;onReparent:typeof onReparent}>(null);
 useLayoutEffect(()=>{committed.current={boundary,props,disabled,busy,onExpandedChange,onToggleLocked,onReparent};});useLayoutEffect(()=>()=>{committed.current=null;},[]);
 const current=()=>committed.current?.boundary===boundary&&!committed.current.disabled?committed.current:null;
 const mutate=(id:string,operation:()=>void|Promise<unknown>)=>{const p=current();if(!p||p.busy||request.current)return Promise.resolve();const token=Symbol();request.current=token;return action.run(id,()=>operation(),undefined,{pendingForAsyncOnly:true}).then(()=>{}).finally(()=>{if(request.current===token)request.current=null;});};
 const allowed=(id:string)=>{const p=current(),row=rows.find(row=>row.layer.id===id);return p&&!p.busy&&row&&!row.inheritedLock&&!row.layer.locked?p:null;};
 const move=(id:string,toIndex:number)=>{const p=allowed(id);if(!p)return;const row=rows.find(row=>row.layer.id===id)!,target=rows[toIndex];if(!target)return;if(!nested)return mutate(id,()=>p.props.onMove(id,toIndex));
  const parent=row.layer.parentId??null;if((target.layer.parentId??null)!==parent)return;const siblings=p.props.layers.filter(layer=>(layer.parentId??null)===parent&&layer.id!==id),index=siblings.findIndex(layer=>layer.id===target.layer.id);const from=rows.findIndex(value=>value.layer.id===id),at=index+(toIndex>from?1:0);if(!p.onReparent)return;validateLayerTreeMove(p.props.layers,id,parent,at);return mutate(id,()=>p.onReparent!(id,parent,at));
 };
 const effective=rows.map(row=>({...row.layer,locked:row.layer.locked||row.inheritedLock||disabled||busy}));
 return <LayerStackBody key={viewIdentity} interactionBoundary={boundary} {...props} busy={busy} actionError={action.error} layers={effective} disabled={disabled||busy} canReorder={!nested||!!onReparent}
  onSelect={id=>{const p=current();if(p)p.props.onSelect(id);}} onToggleVisible={id=>{const p=current();if(p&&!p.busy)void mutate(id,()=>p.props.onToggleVisible(id));}}
  onOpacityPreview={(id,value)=>{const p=allowed(id);if(p)p.props.onOpacityPreview?.(id,value);}} onOpacityCommit={(id,value)=>{const p=allowed(id);if(p)return mutate(id,()=>p.props.onOpacityCommit(id,value));}}
  onMove={move} onRename={(id,name)=>{const p=allowed(id);if(p)return mutate(id,()=>p.props.onRename(id,name));}} {...(props.onRemove?{onRemove:(id:string)=>{const p=allowed(id);if(p)return mutate(id,()=>p.props.onRemove!(id));}}:{})}
  {...(controls?{renderControls:(layer:LayerRow)=>{const row=rows.find(value=>value.layer.id===layer.id)!,original=row.layer;const groups=props.layers.filter(item=>item.kind==='group');return <View style={{height:44,flexDirection:'row',alignItems:'center',gap:4,paddingStart:Math.min(row.depth,6)*8}}>
   {original.kind==='group'?<Button title={expandedIds.includes(layer.id)?'−':'+'} accessibilityLabel={(expandedIds.includes(layer.id)?'Collapse ':'Expand ')+layer.name} disabled={disabled||busy||!row.hasChildren||!onExpandedChange} {...exact({unstyled:props.unstyled})} style={{minWidth:44,minHeight:44}} onPress={()=>{const p=current();if(p&&!p.busy)p.onExpandedChange?.(expandedIds.includes(layer.id)?expandedIds.filter(id=>id!==layer.id):[...expandedIds,layer.id]);}}/>:<View style={{width:44}}/>}
   <Button title={original.locked?'Unlock':'Lock'} accessibilityLabel={(original.locked?'Unlock ':'Lock ')+layer.name} disabled={disabled||busy||row.inheritedLock||!onToggleLocked} {...exact({unstyled:props.unstyled})} style={{minWidth:44,minHeight:44}} onPress={()=>{const p=current();if(p&&!p.busy&&!row.inheritedLock)void mutate(layer.id,()=>p.onToggleLocked?.(layer.id));}}/>
   {nested||onReparent?<View style={{flex:1,minWidth:80}}><MenuButton label={'Group for '+layer.name} editScope={JSON.stringify([scope,revision,layer.id,original.parentId,original.locked,row.inheritedLock,disabled])} disabled={disabled||busy||!!original.locked||row.inheritedLock||!onReparent} {...exact({unstyled:props.unstyled})} items={[{id:'root',label:'Document root'},...groups.map(group=>{let unavailable=false;try{validateLayerTreeMove(props.layers,layer.id,group.id,0);}catch{unavailable=true;}return {id:'group:'+group.id,label:group.name,disabled:unavailable};})]} onSelect={value=>{const p=allowed(layer.id);if(!p?.onReparent)return;const parent=value==='root'?null:value.slice(6);if(parent===(original.parentId??null))return;const toIndex=p.props.layers.filter(item=>item.id!==layer.id&&(item.parentId??null)===parent).length;validateLayerTreeMove(p.props.layers,layer.id,parent,toIndex);void mutate(layer.id,()=>p.onReparent!(layer.id,parent,toIndex));}}><Text numberOfLines={1} {...{className:joinClasses(!props.unstyled&&'text-text')}}>{original.parentId?props.layers.find(item=>item.id===original.parentId)?.name:'Document root'}</Text></MenuButton></View>:null}
   <Text numberOfLines={1} {...{className:joinClasses(!props.unstyled&&'text-text-muted')}}>{'Level '+(row.depth+1)}</Text>
  </View>;}}:{})}/>;
}

function LayerStackBody({
 layers,selectedId,onSelect,onToggleVisible,onOpacityPreview,onOpacityCommit,onMove,onRename,onRemove,
 rowHeight=56,label="Layers",emptyLabel="No layers",accentColor,opacityControl="auto",className,unstyled=false,
 interactionBoundary,onLayout,renderControls,disabled=false,canReorder=true,busy=false,actionError=null,...rest
}:LayerStackProps&{interactionBoundary:string;renderControls?:(layer:LayerRow)=>ReactNode;canReorder?:boolean;busy?:boolean;actionError?:string|null}){
 validateLayers(layers);
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({opacity:null,drag:null,rename:null,width:undefined,editing:null}));
 const store=local.current;
 useLayoutEffect(()=>{store.setState({drag:null,opacity:null,editing:null});},[interactionBoundary,store]);
 const drag=useStore(store,s=>s.drag);
 const width=useStore(store,s=>s.width);
 const primaryHeight=Math.max(LAYER_TOUCH_TARGET,rowHeight),height=primaryHeight+(renderControls?44:0);
 const styled=!unstyled;
 // One row with a thumbnail gives every row the slot, so names and opacity tracks stay in columns.
 const thumbnailSlot=layers.some(l=>l.thumbnail!==undefined);
 // The stack measures itself, not the window: a docked panel is narrow on any screen.
 const mode=opacityControl==="auto"?layerOpacityMode(width,{thumbnail:thumbnailSlot,removable:onRemove!==undefined}):opacityControl;
 // A widened stack or a removed layer drops an open readout popover, so it never reopens by itself later.
 useEffect(()=>{
  const editing=store.getState().editing;
  if(editing!==null&&(mode!=="readout"||!layers.some(l=>l.id===editing)))store.setState({editing:null,opacity:null});
 },[mode,layers,store]);
 return <View {...rest} accessibilityLabel={label}
  onLayout={e=>{store.setState({width:e.nativeEvent.layout.width});onLayout?.(e);}}
   {...{className:joinClasses("min-w-0 overflow-hidden",styled&&"rounded-control bg-surface-sunken",className)}}>
  {/* Scrolling is paused while a row is dragged so the handle keeps the gesture. */}
  <ScrollView scrollEnabled={drag===null} nestedScrollEnabled>
   {layers.length===0
    ?<Text {...{className:joinClasses(styled&&"text-text-muted")}} style={{padding:12}}>{emptyLabel}</Text>
    :layers.map((layer,index)=><LayerStackRow key={layer.id} store={store} layer={layer} index={index}
      count={layers.length} rowHeight={height} primaryHeight={primaryHeight} controls={renderControls?.(layer)} disabled={disabled} canReorder={canReorder} thumbnailSlot={thumbnailSlot} mode={mode} selected={layer.id===selectedId} styled={styled}
      accentColor={accentColor} onSelect={onSelect} onToggleVisible={onToggleVisible}
      onOpacityPreview={onOpacityPreview} onOpacityCommit={onOpacityCommit} onMove={onMove} onRename={onRename}
      {...exact({onRemove})}/>)}
  </ScrollView>
  {busy?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&'text-text-muted')}}>Updating layer</Text>:null}
  <ErrorMessage {...(actionError?{message:actionError}:{})} unstyled={unstyled}/>
 </View>;
}

type RowProps={
 store:StoreApi<Local>;layer:LayerRow;index:number;count:number;rowHeight:number;primaryHeight:number;controls:ReactNode;disabled:boolean;canReorder:boolean;thumbnailSlot:boolean;
 mode:LayerOpacityMode;selected:boolean;
 styled:boolean;accentColor:string|undefined;
}&Pick<LayerStackProps,"onSelect"|"onToggleVisible"|"onOpacityPreview"|"onOpacityCommit"|"onMove"|"onRename"|"onRemove">;

function LayerStackRow(props:RowProps){
 const {store,layer,index,count,rowHeight,selected,styled,accentColor}=props;
 const latest=useRef(props);
 latest.current=props;
 const opacityPreview=useStore(store,s=>s.opacity?.id===layer.id?s.opacity.value:undefined);
 const drag=useStore(store,s=>s.drag?.id===layer.id?s.drag:null);
 const rename=useStore(store,s=>s.rename?.id===layer.id?s.rename:null);
 const locked=props.disabled||layer.locked===true;
 const opacity=opacityPreview??layer.opacity;
 const trackWidth=useRef(0);
 const opacityStart=useRef(layer.opacity);

 const cancelOpacity=()=>{
  const p=latest.current;
  cancelPreview(p.layer.opacity,()=>store.setState({opacity:null}),
   value=>p.onOpacityPreview?.(p.layer.id,value));
 };
 // The one commit path for drag, screen-reader steps and the readout's scrubber.
 const commitOpacity=(value:number)=>{
  const p=latest.current;
  store.setState({opacity:null});
  const next=normalizeOpacity(value);
  return !p.disabled&&!p.layer.locked&&next!==p.layer.opacity?p.onOpacityCommit(p.layer.id,next):undefined;
 };
 const opacityPan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
 if(!opacityPan.current)opacityPan.current=PanResponder.create({
  onStartShouldSetPanResponder:()=>!latest.current.disabled&&latest.current.layer.locked!==true,
  onMoveShouldSetPanResponder:()=>!latest.current.disabled&&latest.current.layer.locked!==true,
  onPanResponderGrant:()=>{
   const p=latest.current;
   opacityStart.current=p.layer.opacity;
   store.setState({opacity:{id:p.layer.id,value:p.layer.opacity}});
  },
  onPanResponderMove:(_e,g)=>{
   const p=latest.current;
   // The fill grows from the start edge, which is the right edge in RTL.
   const next=opacityFromDrag(opacityStart.current,I18nManager.isRTL?-g.dx:g.dx,trackWidth.current);
   const current=store.getState().opacity;
   if(current?.id===p.layer.id&&current.value!==next){
    store.setState({opacity:{id:p.layer.id,value:next}});
    p.onOpacityPreview?.(p.layer.id,next);
   }
  },
  onPanResponderRelease:()=>{
   const current=store.getState().opacity;
   if(current?.id===latest.current.layer.id)void commitOpacity(current.value);
  },
  onPanResponderTerminate:cancelOpacity,
  onPanResponderTerminationRequest:()=>false,
 });

 const move=(toIndex:number)=>{
  const p=latest.current;
  if(p.disabled||!p.canReorder||p.layer.locked||toIndex<0||toIndex>=p.count||toIndex===p.index)return;
  void p.onMove(p.layer.id,toIndex);
 };
 const dragPan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
 if(!dragPan.current)dragPan.current=PanResponder.create({
  onStartShouldSetPanResponder:()=>latest.current.canReorder&&!latest.current.disabled&&latest.current.layer.locked!==true,
  onMoveShouldSetPanResponder:()=>latest.current.canReorder&&!latest.current.disabled&&latest.current.layer.locked!==true,
  onPanResponderGrant:()=>{
   const p=latest.current;
   store.setState({drag:{id:p.layer.id,from:p.index,to:p.index,dy:0}});
  },
  onPanResponderMove:(_e,g)=>{
   const p=latest.current;
   const current=store.getState().drag;
   if(current?.id!==p.layer.id)return;
   store.setState({drag:{...current,dy:g.dy,to:dragTargetIndex(current.from,g.dy,p.rowHeight,p.count)}});
  },
  onPanResponderRelease:()=>{
   const current=store.getState().drag;
   store.setState({drag:null});
   if(current?.id===latest.current.layer.id&&current.to!==current.from)move(current.to);
  },
  // A cancelled drag never reorders.
  onPanResponderTerminate:()=>store.setState({drag:null}),
  onPanResponderTerminationRequest:()=>false,
 });

 const startRename=()=>{
  if(!latest.current.disabled&&!latest.current.layer.locked)store.setState({rename:{id:layer.id,draft:layer.name}});
 };
 const finishRename=()=>{
  const current=store.getState().rename;
  if(current?.id!==layer.id||latest.current.disabled||latest.current.layer.locked)return;
  store.setState({rename:null});
  const next=resolveRename(latest.current.layer.name,current.draft);
  if(next!==undefined)void latest.current.onRename(layer.id,next);
 };

 const removable=props.onRemove!==undefined&&!locked;
 const remove=()=>{
  const p=latest.current;
  if(p.onRemove&&!p.disabled&&p.layer.locked!==true)void p.onRemove(p.layer.id);
 };
 const onRowKey=(e:KeyEvent)=>{
  const key=e.nativeEvent.key;
  if(key==="Escape"){store.setState({drag:null,rename:null});cancelOpacity();e.preventDefault();return;}
  if(e.nativeEvent.altKey&&(key==="ArrowUp"||key==="ArrowDown")){e.preventDefault();move(index+(key==="ArrowUp"?-1:1));return;}
  if(key!=="Delete"&&key!=="Backspace")return;
  if(!removable)return;
  e.preventDefault();
  remove();
 };

 const stepActions=(direction:-1|1)=>{
  if(!locked)void commitOpacity(stepOpacity(layer.opacity,direction));
 };
 const rowActions=[
  {name:"activate"},
  ...(!locked&&index>0?[{name:"moveUp",label:"Move up"}]:[]),
  ...(!locked&&index<count-1?[{name:"moveDown",label:"Move down"}]:[]),
  ...(!locked?[{name:"rename",label:"Rename"}]:[]),
  ...(removable?[{name:"remove",label:"Remove"}]:[]),
 ];
 const accent=accentColor?{backgroundColor:accentColor}:null;
 const text=joinClasses(styled&&(layer.visible?"text-text":"text-text-muted"));
 const muted=joinClasses(styled&&"text-text-muted");
 const percent=Math.round(opacity*100);
 const dimmed={opacity:locked?0.45:1};

 return <View testID={"layer-row-"+layer.id}
   {...{className:joinClasses(styled&&"border-b border-border",styled&&(selected||drag)&&"bg-surface-raised")}}
   style={{height:rowHeight,zIndex:drag?1:0,transform:drag?[{translateY:drag.dy}]:undefined}}>
  <View style={{height:props.primaryHeight,flexDirection:"row",alignItems:"center"}}>
  <View pointerEvents="none" {...{className:joinClasses(styled&&selected&&!accentColor&&"bg-accent")}}
   style={{position:"absolute",start:0,top:0,bottom:0,width:3,...(selected?accent:null)}}/>
  {/* Screen readers reorder through the row's move actions instead of this handle. */}
  <View testID={"layer-reorder-"+layer.id} {...dragPan.current.panHandlers} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
   style={{width:LAYER_TOUCH_TARGET,height:LAYER_TOUCH_TARGET,alignItems:"center",justifyContent:"center",gap:3,...dimmed}}>
   {[0,1,2].map(i=><View key={i} {...{className:joinClasses(styled&&"bg-text-muted")}}
    style={{width:16,height:2,borderRadius:1}}/>)}
  </View>
  <Pressable accessibilityRole="switch" accessibilityLabel={"Show "+layer.name}
   accessibilityState={{checked:layer.visible,disabled:props.disabled}} disabled={props.disabled} onPress={()=>latest.current.onToggleVisible(layer.id)}
   {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
   style={{width:LAYER_TOUCH_TARGET,height:LAYER_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
   <VisibilityGlyph visible={layer.visible} styled={styled}/>
  </Pressable>
  {layer.clippedTo?<ClipIndicator unstyled={!styled}/>:null}
  {layer.thumbnail?<Thumbnail thumbnail={layer.thumbnail} styled={styled} dimmed={!layer.visible}/>
   :props.thumbnailSlot?<View pointerEvents="none" style={{width:LAYER_THUMBNAIL_SIZE,marginEnd:4}}/>:null}
  {/* The name keeps 96pt beside the slider. With the readout it may shrink as a last resort, so remove never clips. */}
  <View style={{flex:1,minWidth:props.mode==="slider"?LAYER_NAME_MIN_WIDTH:0,height:LAYER_TOUCH_TARGET,justifyContent:"center"}}>
   {rename
    ?<TextInput maxLength={512} autoFocus selectTextOnFocus accessibilityLabel={"Name for "+layer.name}
      value={rename.draft} returnKeyType="done"
      onChangeText={draft=>store.setState({rename:{id:layer.id,draft}})}
      onSubmitEditing={finishRename} onBlur={finishRename}
      onKeyPress={e=>{if(e.nativeEvent.key==="Escape")store.setState({rename:null});}}
      {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken text-text")}}
      style={{minHeight:LAYER_TOUCH_TARGET,paddingHorizontal:8}}/>
    :<Pressable accessibilityRole="button" accessibilityLabel={layerAccessibilityLabel(layer,index,count)}
      accessibilityHint={locked?undefined:"Double tap to select. Long press to rename."}
      accessibilityState={{selected,disabled:props.disabled}} disabled={props.disabled} accessibilityActions={rowActions}
      onAccessibilityAction={e=>{
       const action=e.nativeEvent.actionName;
       if(action==="activate")latest.current.onSelect(layer.id);
       else if(action==="moveUp")move(index-1);
       else if(action==="moveDown")move(index+1);
       else if(action==="rename")startRename();
       else if(action==="remove")remove();
      }}
      onPress={()=>latest.current.onSelect(layer.id)} onLongPress={startRename}
      {...{onKeyDown:onRowKey}}
      {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
      style={{minHeight:LAYER_TOUCH_TARGET,justifyContent:"center",paddingHorizontal:4}}>
      <Text numberOfLines={1} {...{className:text}} style={{fontWeight:selected?"700":"500"}}>{layer.name}</Text>
      <Text numberOfLines={1} {...{className:muted}} style={{fontSize:12}}>
       {layerDetail(layer)+(locked?", locked":"")}
      </Text>
     </Pressable>}
  </View>
  {props.mode==="readout"?<OpacityReadout {...props} opacity={opacity} dimmed={dimmed} commit={commitOpacity}/>:<>
  <View {...opacityPan.current.panHandlers}
   accessible accessibilityRole="adjustable" accessibilityLabel={layer.name+" opacity"}
   accessibilityValue={{min:0,max:100,now:percent,text:formatOpacity(opacity)}}
   accessibilityState={{disabled:locked}} aria-disabled={locked}
   {...(Platform.OS==='web'?{tabIndex:locked?-1 as const:0 as const,onKeyDown:(event:KeyEvent)=>{const key=event.nativeEvent.key;if(locked)return;if(key==='Escape'){event.preventDefault();cancelOpacity();return;}if(event.nativeEvent.ctrlKey||event.nativeEvent.metaKey||event.nativeEvent.altKey)return;const rtl=nodeIsRTL(event.currentTarget)||I18nManager.isRTL;const direction=key==='ArrowUp'?1:key==='ArrowDown'?-1:key==='ArrowRight'?(rtl?-1:1):key==='ArrowLeft'?(rtl?1:-1):0;if(direction||key==='Home'||key==='End'){event.preventDefault();void commitOpacity(key==='Home'?0:key==='End'?1:stepOpacity(layer.opacity,direction as -1|1,event.nativeEvent.shiftKey?.5:.05));}}}:{})}
   accessibilityActions={[{name:"increment"},{name:"decrement"}]}
   onAccessibilityAction={e=>{
    if(e.nativeEvent.actionName==="increment")stepActions(1);
    if(e.nativeEvent.actionName==="decrement")stepActions(-1);
   }}
   style={{width:LAYER_OPACITY_SLIDER_WIDTH,minWidth:88,flexShrink:1,height:LAYER_TOUCH_TARGET,flexDirection:"row",alignItems:"center",gap:8,
    paddingEnd:props.onRemove?4:12,...dimmed}}>
   <View onLayout={e=>{trackWidth.current=e.nativeEvent.layout.width;}}
    {...{className:joinClasses(styled&&"bg-surface-raised")}}
    style={{flex:1,height:4,borderRadius:2,overflow:"hidden"}}>
    <View {...{className:joinClasses(styled&&!accentColor&&"bg-accent")}}
     style={{width:percent+"%",height:4,...accent}}/>
   </View>
   <Text {...{className:muted}} style={{width:40,textAlign:"right",fontVariant:["tabular-nums"],fontSize:12}}>
    {formatOpacity(opacity)}
   </Text>
  </View>
  </>}
  {/* Shown only when the host can delete layers. Locked rows keep the slot, disabled, so columns line up. */}
  {props.onRemove?<Pressable accessibilityRole="button" accessibilityLabel={"Remove "+layer.name}
   accessibilityState={{disabled:locked}} disabled={locked} onPress={remove}
   {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
   style={{width:LAYER_TOUCH_TARGET,height:LAYER_TOUCH_TARGET,alignItems:"center",justifyContent:"center",...dimmed}}>
   <RemoveGlyph styled={styled}/>
  </Pressable>:null}
  </View>
  {props.controls}
 </View>;
}

type ReadoutProps=RowProps&{opacity:number;dimmed:{opacity:number};commit:(value:number)=>unknown};

/**
 * Narrow-row opacity: a percentage button that opens a PrecisionScrubber in a
 * popover anchored to it. The scrubber previews through `onOpacityPreview`,
 * commits once through `onOpacityCommit`, and a cancelled drag (Escape, a
 * second pointer, or closing the popover mid-drag) restores the committed value.
 */
function OpacityReadout({store,layer,styled,opacity,dimmed,onOpacityPreview,commit}:ReadoutProps){
 const open=useStore(store,s=>s.editing===layer.id);
 const locked=layer.locked===true;
 // Closing drops any preview, so the readout shows the committed value again.
 const setOpen=(next:boolean)=>store.setState(next?{editing:layer.id}:{editing:null,opacity:null});
 return <View style={{width:LAYER_OPACITY_READOUT_WIDTH,height:LAYER_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
  <AnchoredPopover open={open&&!locked} onOpenChange={setOpen} accessibilityLabel={layer.name+" opacity"} width={300}
   trigger={({toggle,triggerProps})=><Pressable {...triggerProps} accessibilityRole="button"
    accessibilityLabel={layer.name+" opacity, "+formatOpacity(opacity)}
    accessibilityHint={locked?undefined:"Opens a scrubber to change opacity."}
    accessibilityState={{...triggerProps.accessibilityState,disabled:locked}} aria-disabled={locked||undefined}
    disabled={locked} onPress={toggle}
    {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus",
      styled&&!locked&&"hover:bg-surface-raised")}}
    style={{minWidth:LAYER_OPACITY_READOUT_WIDTH,height:LAYER_TOUCH_TARGET,alignItems:"center",justifyContent:"center",
     paddingHorizontal:4,...dimmed}}>
    <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text-muted")}}
     style={{fontVariant:["tabular-nums"],fontSize:12}}>{formatOpacity(opacity)}</Text>
   </Pressable>}>
   <View style={{padding:12}}>
    <PrecisionScrubber label={layer.name+" opacity"} value={Math.round(layer.opacity*100)} min={0} max={100} step={1}
     unit="%" disabled={locked}
     onPreview={value=>{
      const next=normalizeOpacity(value/100);
      store.setState({opacity:{id:layer.id,value:next}});
      onOpacityPreview?.(layer.id,next);
     }}
     onCommit={value=>commit(value/100)}/>
   </View>
  </AnchoredPopover>
 </View>;
}

/**
 * Hidden from screen readers in every case: a labelled preview is spoken as
 * part of the row label, so it is never a separate stop.
 */
function Thumbnail({thumbnail,styled,dimmed}:{thumbnail:LayerThumbnail;styled:boolean;dimmed:boolean}){
 const fill="fill" in thumbnail?{backgroundColor:thumbnail.fill}:null;
 return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
  {...{"aria-hidden":true,className:joinClasses(styled&&"rounded-control border border-border",styled&&!fill&&"bg-surface-sunken")}}
  style={{width:LAYER_THUMBNAIL_SIZE,height:LAYER_THUMBNAIL_SIZE,marginEnd:4,overflow:"hidden",
   alignItems:"center",justifyContent:"center",opacity:dimmed?0.45:1,...fill}}>
  {"node" in thumbnail?thumbnail.node:null}
 </View>;
}

/** Two crossed bars drawn with views in the muted text token, matching the row's other glyphs. */
function RemoveGlyph({styled}:{styled:boolean}){
 const bar=joinClasses(styled&&"bg-text-muted");
 return <View pointerEvents="none" style={{width:14,height:14,alignItems:"center",justifyContent:"center"}}>
  <View {...{className:bar}} style={{position:"absolute",width:16,height:1.5,borderRadius:1,transform:[{rotate:"45deg"}]}}/>
  <View {...{className:bar}} style={{position:"absolute",width:16,height:1.5,borderRadius:1,transform:[{rotate:"-45deg"}]}}/>
 </View>;
}

/** Eye-like ring: filled pupil when visible, struck through when hidden. */
function VisibilityGlyph({visible,styled}:{visible:boolean;styled:boolean}){
 return <View pointerEvents="none" style={{width:20,height:12,alignItems:"center",justifyContent:"center"}}>
  <View {...{className:joinClasses(styled&&(visible?"border-text":"border-text-muted"))}}
   style={{width:20,height:12,borderRadius:6,borderWidth:1.5,alignItems:"center",justifyContent:"center"}}>
   {visible?<View {...{className:joinClasses(styled&&"bg-text")}} style={{width:5,height:5,borderRadius:2.5}}/>:null}
  </View>
  {visible?null:<View {...{className:joinClasses(styled&&"bg-text-muted")}}
   style={{position:"absolute",width:24,height:1.5,transform:[{rotate:"-30deg"}]}}/>}
 </View>;
}
