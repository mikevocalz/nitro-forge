import {forgeHairlineRadius} from "../radius.ts";
import {useEffect,useLayoutEffect,useRef,type ComponentRef} from "react";
import {I18nManager,Platform,Pressable,ScrollView,Text,TextInput,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {DragGrabHandle} from "@nyc-tron/ui/components/DragGrabHandle";
import {domIsRTL} from "@nyc-tron/ui/components/forms/choice-keys";
import type {DragPoint,DragTransport,DragTransportProps} from "@nyc-tron/ui/components/gestures/drag-transport";
import {PanResponderDrag} from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {LayerThumbnail} from "./LayerThumbnail.tsx";
import {resolveRename} from "./layer-model.ts";
import {PanelButton,Reason} from "./panel-button.tsx";
import type {RasterPixels,ThumbnailCache} from "./layer-thumbnail-model.ts";
import {
  artboardAccessibilityLabel,artboardColumns,artboardDropIndex,artboardKeyAction,artboardThumbnailId,
  formatArtboardSize,newArtboardOp,validateArtboards,
  type AddArtboardOp,type ArtboardItem,type ArtboardLayout,type MoveArtboardOp,type RemoveArtboardOp,type UpdateArtboardOp,
} from "./artboard-model.ts";
import { controlTokens, tokens } from "../tokens.ts";

/** Props for {@linkcode ArtboardNavigator}. Each `on*Artboard` payload is one engine op's argument. */
export interface ArtboardNavigatorProps extends Omit<ViewProps,"children"> {
  scope?:string;revision?:string|number;disabled?:boolean;
  /** Artboards in document order, as `describe.artboards` lists them. */
  artboards:readonly ArtboardItem[];
  selectedId?:string|undefined;
  /** Tap, Enter or Space on an artboard: the host selects it and brings it into view. */
  onSelect:(id:string)=>void;
  /** `addArtboard`; the navigator proposes a name, size and a spot right of the others. */
  onAddArtboard:(op:AddArtboardOp,signal?:AbortSignal)=>void|Promise<unknown>;
  /** `updateArtboard`; the navigator only renames. */
  onUpdateArtboard:(op:UpdateArtboardOp,signal?:AbortSignal)=>void|Promise<unknown>;
  /** `removeArtboard`. No confirmation: the host's undo restores it. */
  onRemoveArtboard:(op:RemoveArtboardOp,signal?:AbortSignal)=>void|Promise<unknown>;
  /** `moveArtboard`, once per drag release or Alt+arrow press. */
  onMoveArtboard:(op:MoveArtboardOp,signal?:AbortSignal)=>void|Promise<unknown>;
  /** Loads a preview (`artboardThumbnail {id, max}`, decoded). */
  loadThumbnail:(id:string,max:number,signal?:AbortSignal)=>Promise<RasterPixels>;
  /** @default "list" */
  layout?:ArtboardLayout;
  /** @default "Artboards" */
  label?:string;
  cache?:ThumbnailCache;
  className?:string;
  unstyled?:boolean;
}

type Drag={id:string;from:number;to:number;dx:number;dy:number};
type Local={width:number;focusId:string|null;drag:Drag|null;rename:{id:string;draft:string}|null};
type Focusable={focus?:()=>void};
type KeyLike={nativeEvent?:{key?:string;altKey?:boolean};key?:string;altKey?:boolean;preventDefault?:()=>void;currentTarget?:unknown};

const LIST_ROW=64;
const GAP=8;
const NO_SELECT=(Platform.OS==="web"?{userSelect:"none"}:{}) as object;

/**
 * Artboard list or grid with previews (B-14). Select by tap, Enter or Space;
 * add, rename (long press or F2), remove (button or Delete) and reorder by
 * dragging the grip or with Alt+arrows. Arrows and Home/End move focus.
 * Everything is controlled: each action reports one engine op.
 */
export function ArtboardNavigator({scope='artboards',revision=0,disabled=false,...props}:ArtboardNavigatorProps){
 validateArtboards(props.artboards);if(!scope.trim()||scope.length>512||!['list','grid'].includes(props.layout??'list')||!(props.label??'Artboards').trim()||(props.label??'Artboards').length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid artboard navigator identity');
 const owner=JSON.stringify([scope,revision,disabled]),boundary=JSON.stringify([owner,props.artboards,props.layout]),action=useOwnedAction(owner),busy=action.pending!==null,request=useRef<symbol|null>(null),committed=useRef<null|{boundary:string;props:typeof props}>(null);
 useLayoutEffect(()=>{committed.current={boundary,props};});useLayoutEffect(()=>{request.current=null;},[owner]);useLayoutEffect(()=>()=>{committed.current=null;},[]);
 const current=()=>!disabled&&!busy&&committed.current?.boundary===boundary?committed.current.props:null;
 const run=(name:string,operation:(p:typeof props,signal:AbortSignal)=>void|Promise<unknown>)=>{const p=current();if(!p||request.current)return;const token=Symbol();request.current=token;return action.run(name,signal=>operation(p,signal),undefined,{pendingForAsyncOnly:true}).finally(()=>{if(request.current===token)request.current=null;});};
 return <ArtboardNavigatorBody key={owner} {...props} scope={scope} disabled={disabled||busy} busy={busy} actionError={action.error}
  onSelect={id=>{const p=current();if(p&&p.artboards.some(a=>a.id===id))p.onSelect(id);}}
  onAddArtboard={op=>run('add',(p,signal)=>p.onAddArtboard(op,signal))}
  onUpdateArtboard={op=>{if(props.artboards.some(a=>a.id===op.id))return run('rename',(p,signal)=>p.onUpdateArtboard(op,signal));}}
  onRemoveArtboard={op=>{if(props.artboards.some(a=>a.id===op.id))return run('remove',(p,signal)=>p.onRemoveArtboard(op,signal));}}
  onMoveArtboard={op=>{if(props.artboards.some(a=>a.id===op.id)&&Number.isInteger(op.to_index)&&op.to_index>=0&&op.to_index<props.artboards.length)return run('move',(p,signal)=>p.onMoveArtboard(op,signal));}}/>;
}

function ArtboardNavigatorBody({
  scope="artboards",disabled=false,busy=false,actionError=null,artboards,selectedId,onSelect,onAddArtboard,onUpdateArtboard,onRemoveArtboard,onMoveArtboard,loadThumbnail,
  layout="list",label="Artboards",cache,className,unstyled=false,...rest
}:ArtboardNavigatorProps&{busy?:boolean;actionError?:string|null}){
  validateArtboards(artboards);
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({width:0,focusId:null,drag:null,rename:null}));
  const store=local.current;
  const width=useStore(store,s=>s.width);
  const drag=useStore(store,s=>s.drag);
  const focusId=useStore(store,s=>s.focusId);
  const rename=useStore(store,s=>s.rename);
  const host=useRef<ComponentRef<typeof View>|null>(null);
  const tiles=useRef(new Map<string,Focusable|null>());
  const latest=useRef({artboards,onSelect,onUpdateArtboard,onRemoveArtboard,onMoveArtboard});
  useLayoutEffect(()=>{latest.current={artboards,onSelect,onUpdateArtboard,onRemoveArtboard,onMoveArtboard};});
  const pressed=useRef<DragPoint|undefined>(undefined);
  const transport=useRef<DragTransport|null>(null);
  if(!transport.current)transport.current=function PressPointDrag(props:DragTransportProps){
    return <PanResponderDrag {...props} onBegin={p=>{pressed.current=p;props.onBegin(p);}}/>;
  };
  const styled=!unstyled;
  const columns=layout==="grid"?artboardColumns(width,GAP):1;
  const tileWidth=layout==="grid"&&width>0?(width-GAP*(columns-1))/columns:0;
  const thumbHeight=Math.round(Math.max(44,tileWidth-12)*0.62);
  const cellHeight=layout==="grid"?thumbHeight+56+GAP:LIST_ROW+4;
  const rtl=()=>I18nManager.isRTL||domIsRTL(host.current);
  const roving=focusId!==null&&artboards.some(a=>a.id===focusId)?focusId:(artboards.some(a=>a.id===selectedId)?selectedId:artboards[0]?.id);
  const geometry=JSON.stringify([layout,disabled,artboards.map(a=>[a.id,a.x,a.y,a.w,a.h])]);
  useLayoutEffect(()=>{store.setState({drag:null,rename:null});pressed.current=undefined;},[geometry,width]);

  // Keyboard focus moves after the render that made the tile the roving stop
  // (and, after a reorder, after the host re-rendered it at its new index).
  const pendingFocus=useRef<string|null>(null);
  useEffect(()=>{
    const id=pendingFocus.current;
    if(id===null||disabled)return;
    pendingFocus.current=null;
    tiles.current.get(id)?.focus?.();
  });
  const focusTile=(id:string)=>{
    pendingFocus.current=id;
    store.setState({focusId:id});
  };
  const move=(id:string,to:number)=>{
    if(disabled)return;
    const from=latest.current.artboards.findIndex(a=>a.id===id);
    if(from<0||to===from||to<0||to>=latest.current.artboards.length)return;
    latest.current.onMoveArtboard({id,to_index:to});
  };
  const startRename=(a:ArtboardItem)=>{if(!disabled)store.setState({rename:{id:a.id,draft:a.name}});};
  const finishRename=()=>{
    const current=store.getState().rename;
    if(!current||disabled)return;
    store.setState({rename:null});
    const a=latest.current.artboards.find(x=>x.id===current.id);
    const name=a?resolveRename(a.name,current.draft):undefined;
    if(a&&name!==undefined)latest.current.onUpdateArtboard({id:a.id,name});
  };
  const remove=(id:string)=>{
    if(disabled)return;
    const list=latest.current.artboards;
    const i=list.findIndex(a=>a.id===id);
    const next=list[i+1]??list[i-1];
    latest.current.onRemoveArtboard({id});
    if(next&&store.getState().focusId===id)focusTile(next.id);
  };
  const onKey=(a:ArtboardItem,index:number)=>(event:KeyLike)=>{
    if(disabled||store.getState().rename)return;
    const key=event.nativeEvent?.key??event.key;
    const alt=event.nativeEvent?.altKey??event.altKey??false;
    const action=artboardKeyAction(key,{index,count:artboards.length,columns,layout,alt,
      rtl:I18nManager.isRTL||domIsRTL(event.currentTarget)});
    if(!action)return;
    event.preventDefault?.();
    if(action.kind==="focus")focusTile(artboards[action.index]!.id);
    else if(action.kind==="move"){focusTile(a.id);move(a.id,action.to);}
    else if(action.kind==="select")onSelect(a.id);
    else if(action.kind==="rename")startRename(a);
    else remove(a.id);
  };
  const dragHandlers=(a:ArtboardItem,index:number)=>({
    onStart:()=>{if(!disabled)store.setState({drag:{id:a.id,from:index,to:index,dx:0,dy:0}});},
    onMove:(p:DragPoint)=>{
      const d=store.getState().drag;
      if(!d||d.id!==a.id)return;
      const start=pressed.current??p;
      const dx=p.x-start.x,dy=p.y-start.y;
      const to=artboardDropIndex({from:d.from,dx,dy,count:latest.current.artboards.length,columns,
        cellWidth:Math.max(1,tileWidth+GAP),cellHeight,rtl:rtl()});
      store.setState({drag:{...d,dx,dy,to}});
    },
    onCommit:()=>{
      const d=store.getState().drag;
      store.setState({drag:null});
      pressed.current=undefined;
      if(d&&d.to!==d.from)move(d.id,d.to);
    },
    onCancel:()=>{store.setState({drag:null});pressed.current=undefined;},
  });
  const muted=joinClasses(styled&&"text-text-muted text-xs");

  const tile=(a:ArtboardItem,index:number)=>{
    const selected=a.id===selectedId;
    const dragging=drag?.id===a.id;
    const target=drag!==null&&!dragging&&drag.to===index;
    const editing=rename?.id===a.id?rename:null;
    const grid=layout==="grid";
    // Grid tiles have 4pt padding inside a 2pt border.
    const thumb=<LayerThumbnail scope={scope} width={grid?Math.max(44,tileWidth-12):tokens.spacing.fixedPage} height={grid?thumbHeight:tokens.spacing.off48} unstyled={unstyled}
      source={{kind:"loader",id:artboardThumbnailId(a.id),revision:a.revision??0,load:(_id,max,signal)=>loadThumbnail(a.id,max,signal)}}
      {...(cache?{cache}:{})}/>;
    const name=editing
      ?<TextInput maxLength={512} editable={!disabled} autoFocus selectTextOnFocus accessibilityLabel={"Name for "+a.name} value={editing.draft}
        returnKeyType="done" onChangeText={draft=>store.setState({rename:{id:a.id,draft}})}
        onSubmitEditing={finishRename} onBlur={finishRename}
        onKeyPress={e=>{if(e.nativeEvent.key==="Escape")store.setState({rename:null});}}
        {...{className:joinClasses(styled&&"rounded-control border border-focus bg-surface-sunken text-text")}}
        style={{minHeight:tokens.spacing.fixedTarget,paddingHorizontal:tokens.spacing.fixedElement,minWidth:0}}/>
      :<View style={{gap:tokens.spacing.off2,minWidth:0}}>
        <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm")}}
          style={{fontWeight:selected?"700":"500"}}>{a.name}</Text>
        <Text numberOfLines={1} {...{className:muted}} style={{fontVariant:["tabular-nums"]}}>{formatArtboardSize(a)}</Text>
      </View>;
    const grip=<DragGrabHandle disabled={disabled} label={"Reorder "+a.name} unstyled={unstyled} transport={transport.current!}
      {...dragHandlers(a,index)}
      {...(grid?{className:joinClasses(styled&&"bg-surface-raised border border-border")}:{})}/>;
    const removeButton=<Pressable disabled={disabled} accessibilityState={{disabled}} accessibilityRole="button" accessibilityLabel={"Remove "+a.name} onPress={()=>remove(a.id)}
      {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus",
        styled&&grid&&"bg-surface-raised border border-border")}}
      style={{width:tokens.spacing.fixedTarget,height:tokens.spacing.fixedTarget,alignItems:"center",justifyContent:"center"}}>
      <Cross styled={styled}/>
    </Pressable>;
    const main=<Pressable ref={node=>{tiles.current.set(a.id,node as unknown as Focusable|null);}}
      accessibilityRole="button" accessibilityLabel={artboardAccessibilityLabel(a,index,artboards.length)}
      accessibilityHint="Double tap to go to this artboard. Long press to rename."
      accessibilityState={{selected,disabled}} aria-selected={selected} disabled={disabled}
      accessibilityActions={disabled?[]:[{name:"activate"},
        ...(index>0?[{name:"moveUp",label:"Move earlier"}]:[]),
        ...(index<artboards.length-1?[{name:"moveDown",label:"Move later"}]:[]),
        {name:"rename",label:"Rename"},{name:"remove",label:"Remove"}]}
      onAccessibilityAction={e=>{
        if(disabled)return;const n=e.nativeEvent.actionName;
        if(n==="activate")onSelect(a.id);
        else if(n==="moveUp")move(a.id,index-1);
        else if(n==="moveDown")move(a.id,index+1);
        else if(n==="rename")startRename(a);
        else if(n==="remove")remove(a.id);
      }}
      onPress={()=>{if(!disabled)onSelect(a.id);}} onLongPress={()=>startRename(a)} onFocus={()=>store.setState({focusId:a.id})}
      {...{onKeyDown:onKey(a,index),tabIndex:!disabled&&a.id===roving?0:-1}}
      {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
      style={grid?{gap:tokens.spacing.off6,padding:tokens.spacing.fixedStack}:{flex:1,minWidth:0,flexDirection:"row",alignItems:"center",gap:tokens.spacing.off10,minHeight:LIST_ROW-tokens.spacing.fixedElement,paddingHorizontal:tokens.spacing.fixedStack}}>
      {thumb}
      {grid?null:<View style={{flex:1,minWidth:0}}>{editing?null:name}</View>}
      {grid&&!editing?<View style={{paddingHorizontal:tokens.spacing.fixedStack,minHeight:tokens.spacing.fixedTarget,justifyContent:"center"}}>{name}</View>:null}
    </Pressable>;
    return <View key={a.id}
      {...{className:joinClasses(styled&&"rounded-card border",
        styled&&(target?"border-accent":selected?"border-primary":"border-transparent"),
        styled&&(selected||dragging?"bg-surface-raised":"bg-transparent"))}}
      style={[grid?{width:tileWidth,marginBottom:GAP}:{flexDirection:"row",alignItems:"center",minHeight:LIST_ROW,marginBottom:tokens.spacing.fixedStack},
        {borderWidth:target||selected?tokens.borderWidth.strong:tokens.borderWidth.hairline,zIndex:dragging?controlTokens.layer.lifted:0,
          transform:dragging&&drag?[{translateX:layout==="grid"?drag.dx:0},{translateY:drag.dy}]:undefined,
          opacity:dragging?controlTokens.opacity.strong:1},dragging?NO_SELECT:null]}>
      {grid?null:grip}
      {main}
      {grid&&editing?<View style={{paddingHorizontal:tokens.spacing.fixedStack,paddingBottom:tokens.spacing.fixedStack}}>{name}</View>:null}
      {!grid&&editing?<View style={{flex:1,minWidth:0}}>{name}</View>:null}
      {grid?null:removeButton}
      {grid?<View pointerEvents="box-none" style={{position:"absolute",top:tokens.spacing.fixedElement,start:8,end:8,flexDirection:"row",justifyContent:"space-between"}}>
        {grip}{removeButton}
      </View>:null}
    </View>;
  };

  let addReason=disabled?'Artboard editing is unavailable':undefined;
  if(!addReason)try{newArtboardOp(artboards,selectedId);}catch(error){addReason=error instanceof Error?error.message:String(error);}
  const add=<PanelButton reason={addReason} label="Add artboard" tone="secondary" styled={styled} icon={<Plus styled={styled}/>}
    onPress={()=>onAddArtboard(newArtboardOp(latest.current.artboards,selectedId))}/>;
  return <View {...rest} ref={host} accessibilityLabel={label}
    {...{className:joinClasses("min-w-0 gap-2",styled&&"rounded-control bg-surface-sunken p-2",className)}}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:tokens.spacing.fixedElement,paddingStart:4}}>
      <Text accessibilityRole="header" {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>
        {label+(artboards.length?" ("+artboards.length+")":"")}
      </Text>
      {add}
    </View>
    <Reason text={addReason} styled={styled}/>
    {artboards.length===0
      ?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{padding:tokens.spacing.fixedElement}}>
        No artboards yet. Add one for each page or screen size you design.
      </Text>
      :<ScrollView scrollEnabled={drag===null} nestedScrollEnabled
        onLayout={e=>{const w=e.nativeEvent.layout.width;if(Number.isFinite(w)&&w>=0&&w!==store.getState().width)store.setState({width:w});}}
        contentContainerStyle={layout==="grid"?{flexDirection:"row",flexWrap:"wrap",columnGap:GAP}:undefined}>
        {width>0||layout==="list"?artboards.map(tile):null}
      </ScrollView>}
    {busy?<Text accessibilityLiveRegion="polite" {...{className:muted}}>Updating artboards</Text>:null}
    <ErrorMessage {...(actionError?{message:actionError}:{})} unstyled={unstyled}/>
  </View>;
}

function Cross({styled}:{styled:boolean}){
  const bar=joinClasses(styled&&"bg-text-muted");
  return <View pointerEvents="none" style={{width:tokens.spacing.off14,height:tokens.spacing.off14,alignItems:"center",justifyContent:"center"}}>
    <View {...{className:bar}} style={{position:"absolute",width:tokens.spacing.fixedGroup,height:tokens.spacing.off1_5,borderRadius:forgeHairlineRadius.tick,transform:[{rotate:"45deg"}]}}/>
    <View {...{className:bar}} style={{position:"absolute",width:tokens.spacing.fixedGroup,height:tokens.spacing.off1_5,borderRadius:forgeHairlineRadius.tick,transform:[{rotate:"-45deg"}]}}/>
  </View>;
}

function Plus({styled}:{styled:boolean}){
  const bar=joinClasses(styled&&"bg-text");
  return <View pointerEvents="none" style={{width:tokens.spacing.fixedInset,height:tokens.spacing.fixedInset,alignItems:"center",justifyContent:"center"}}>
    <View {...{className:bar}} style={{position:"absolute",width:tokens.spacing.fixedInset,height:tokens.spacing.off1_5,borderRadius:forgeHairlineRadius.tick}}/>
    <View {...{className:bar}} style={{position:"absolute",width:tokens.spacing.off1_5,height:tokens.spacing.fixedInset,borderRadius:forgeHairlineRadius.tick}}/>
  </View>;
}
