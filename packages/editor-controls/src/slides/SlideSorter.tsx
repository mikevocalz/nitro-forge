import {forgeRadius} from "../radius.ts";
import {validateSlideSummary} from './slide-model.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useRef,useLayoutEffect,type ReactNode} from "react";
import {I18nManager,Pressable,FlatList,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {ToolButton,officeKey,type OfficeKeyEvent} from "../office/office-controls.tsx";
import {SlideThumbnail} from "./SlideThumbnail.tsx";
import {SLIDE_DEFAULT_SIZE,gridColumns,gridMove,moveBlock,nextSelection,slideLabel,type SlideObject,type SlideSize,type SlideSummary} from "./slide-model.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** Props for {@linkcode SlideSorter}. Selection is controlled; actions render only when their callbacks are passed. */
export interface SlideSorterProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly slides:readonly SlideSummary[];
  readonly selectedIds:readonly string[];
  readonly onSelectionChange:(ids:string[])=>void;
  /** Opens a slide in the editor (double press or Enter). */
  readonly onOpen?:((id:string)=>void)|undefined;
  /**
   * Applies a new deck order after the selection was moved as a block. The
   * host turns it into engine moves (`planMoves` gives single from/to steps).
   */
  readonly onReorder?:((order:string[])=>void|Promise<unknown>)|undefined;
  /** Deletes the selected slides. Not offered when it would delete every slide. */
  readonly onRemove?:((ids:string[])=>void|Promise<unknown>)|undefined;
  readonly size?:SlideSize;
  readonly renderImage?:(src:string,object:SlideObject)=>ReactNode;
  /** Smallest thumbnail width in points; columns are fitted to the measured width. @default 160 */
  readonly minThumbnailWidth?:number;
  disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const GAP=12;

/**
 * Slide sorter grid (J-02) with multiselect: a press selects one slide,
 * Cmd/Ctrl adds or removes, Shift selects a range, and "Select" mode makes
 * presses toggle on touch screens. The selection moves as a block to the
 * start, one place earlier or later, or the end. Arrow keys move focus in the
 * grid, Space toggles, Enter opens.
 */
export function SlideSorter({scope='SlideSorter',revision=0,...props}:SlideSorterProps){
 if(props.slides.length>10000||props.slides.reduce((n,s)=>n+s.objects.length,0)>100000||new Set(props.slides.map(s=>s.id)).size!==props.slides.length||props.selectedIds.some(id=>!props.slides.some(s=>s.id===id)))throw new RangeError('Invalid slide sorter roster');props.slides.forEach(validateSlideSummary);
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=useEditorBoundary([JSON.stringify([identity,props.disabled,props.disabledReason,props.slides.map(s=>s.id)])]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <SlideSorterBody key={identity} {...props} boundary={owner} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onReorder={props.onReorder?(...args:Parameters<NonNullable<SlideSorterProps['onReorder']>>)=>guard.run('onReorder',h=>h.onReorder?.(...args)):undefined}
  onRemove={props.onRemove?(...args:Parameters<NonNullable<SlideSorterProps['onRemove']>>)=>guard.run('onRemove',h=>h.onRemove?.(...args)):undefined}
  onSelectionChange={(...args:Parameters<NonNullable<SlideSorterProps['onSelectionChange']>>)=>{guard.current()?.onSelectionChange?.(...args);}}
  onOpen={props.onOpen?(...args:Parameters<NonNullable<SlideSorterProps['onOpen']>>)=>{guard.current()?.onOpen?.(...args);}:undefined}
 />;
}
function SlideSorterBody({boundary,actionError,disabledReason,disabled=false,
  slides,selectedIds,onSelectionChange,onOpen,onReorder,onRemove,size=SLIDE_DEFAULT_SIZE,renderImage,minThumbnailWidth=160,
  className,unstyled=false,...rest
}:SlideSorterProps&{boundary:string;actionError?:string|null}){
  const styled=!unstyled;
  const [local,store]=useLocalStore(()=>({width:0,anchor:undefined as string|undefined,multi:false}));
  const refs=useRef(new Map<number,{focus?:()=>void}|null>());
  const order=slides.map(s=>s.id);
  const columns=gridColumns(local.width,minThumbnailWidth,GAP);
  const cell=local.width>0?Math.floor((local.width-GAP*(columns-1))/columns):minThumbnailWidth;
  const tileHeight=Math.ceil((cell-8)*size.height/size.width+40),list=useRef<FlatList<SlideSummary>|null>(null),scrollAnchor=useRef(0),pendingFocus=useRef<number|null>(null);
  useLayoutEffect(()=>{list.current?.scrollToOffset({offset:Math.floor(scrollAnchor.current/columns)*(tileHeight+GAP),animated:false});},[columns,tileHeight]);
  const selected=new Set(selectedIds);
  const count=selected.size;
  const indexes=order.map((id,i)=>selected.has(id)?i:-1).filter(i=>i>=0);
  const first=indexes[0]??-1,last=indexes.at(-1)??-1;
  const reorder=(to:number)=>{
    if(disabled||!onReorder||count===0)return;
    const next=moveBlock(order,selectedIds,to);
    if(next.some((id,i)=>id!==order[i]))void onReorder(next);
  };
  const pick=(id:string,mode:"replace"|"toggle"|"range")=>{
    if(disabled)return;
    const r=nextSelection(order,selectedIds,local.anchor,id,mode);
    store.set(s=>({...s,anchor:r.anchor}));
    onSelectionChange(r.selected);
  };
  const muted=joinClasses(styled&&"text-text-muted text-sm");
  return <View {...rest} accessibilityLabel="Slide sorter" {...{className:joinClasses("min-w-0",className)}}
    style={[{gap:tokens.spacing.off10},rest.style as object]}>
    <View style={{flexDirection:"row",alignItems:"center",gap:tokens.spacing.fixedStack,flexWrap:"wrap"}}>
      <ToolButton label="Select" checked={local.multi} styled={styled} accessibilityHint="Presses add or remove slides from the selection"
        onPress={()=>store.set(s=>({...s,multi:!s.multi}))}/>
      <Text accessibilityLiveRegion="polite" {...{className:muted}} style={{paddingHorizontal:tokens.spacing.off6}}>
        {count===0?"No slides selected":count===1?"1 slide selected":count+" slides selected"}
      </Text>
      {onReorder?<>
        <ToolButton label="Move to start" disabled={disabled||count===0||last<count} styled={styled} onPress={()=>reorder(0)}/>
        <ToolButton label="Move earlier" disabled={disabled||count===0||first<=0} styled={styled} onPress={()=>reorder(first-1)}/>
        <ToolButton label="Move later" disabled={disabled||count===0||last>=order.length-1} styled={styled} onPress={()=>reorder(first+1)}/>
        <ToolButton label="Move to end" disabled={disabled||count===0||first>=order.length-count} styled={styled} onPress={()=>reorder(order.length)}/>
      </>:null}
      {onRemove?<ToolButton label={count>1?"Delete "+count+" slides":"Delete slide"} disabled={disabled||count===0||count>=order.length}
        styled={styled} onPress={()=>void onRemove(order.filter(id=>selected.has(id)))}/>:null}
    </View>
    <FlatList ref={list} key={columns} numColumns={columns} data={slides} keyExtractor={slide=>slide.id} initialNumToRender={Math.max(6,columns*2)} windowSize={5} removeClippedSubviews={false}
      initialScrollIndex={Math.floor(scrollAnchor.current/columns)} getItemLayout={(_data,index)=>({length:tileHeight+GAP,offset:(tileHeight+GAP)*index,index})}
      onScroll={e=>{scrollAnchor.current=Math.max(0,Math.floor(e.nativeEvent.contentOffset.y/(tileHeight+GAP))*columns);}} scrollEventThrottle={32}
      onLayout={e=>store.set(s=>({...s,width:e.nativeEvent.layout.width}))} style={{maxHeight:tokens.spacing.off600}} contentContainerStyle={{gap:GAP}} columnWrapperStyle={columns>1?{gap:GAP}:undefined}
      extraData={[selectedIds,disabled,local.multi]} renderItem={({item:slide,index})=>{

        const on=selected.has(slide.id);
        const onKeyDown=(e:OfficeKeyEvent)=>{
          const {key,shift,mod}=officeKey(e);
          const next=gridMove(index,key,columns,slides.length,I18nManager.isRTL);
          let handled=true;
          if(next!==undefined){
            const node=refs.current.get(next);if(node)node.focus?.();else{pendingFocus.current=next;list.current?.scrollToOffset({offset:Math.floor(next/columns)*(tileHeight+GAP),animated:false});}
            if(shift)pick(order[next]!,"range");
          }
          else if(key===" ")pick(slide.id,"toggle");
          else if(key==="Enter"&&onOpen)onOpen(slide.id);
          else if(mod&&key.toLowerCase()==="a")onSelectionChange([...order]);
          else handled=false;
          if(handled)(e as unknown as {preventDefault?:()=>void}).preventDefault?.();
        };
        return <View key={slide.id} style={{width:cell,height:tileHeight,gap:tokens.spacing.fixedStack}}>
          <Pressable disabled={disabled} ref={node=>{refs.current.set(index,node as unknown as {focus?:()=>void}|null);if(node&&pendingFocus.current===index){(node as unknown as {focus?:()=>void}).focus?.();pendingFocus.current=null;}}}
            accessibilityRole="checkbox" accessibilityLabel={slideLabel(slide,index,slides.length)} accessibilityState={{checked:on}}
            accessibilityHint={onOpen?"Double tap to select. Use the open action to edit.":undefined}
            accessibilityActions={onOpen?[{name:"activate"},{name:"open",label:"Open slide"}]:[{name:"activate"}]}
            onAccessibilityAction={e=>{if(e.nativeEvent.actionName==="open")onOpen?.(slide.id);else pick(slide.id,"toggle");}}
            onPress={e=>{
              const n=(e as unknown as {nativeEvent?:{shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean}}).nativeEvent??{};
              pick(slide.id,n.shiftKey?"range":n.metaKey||n.ctrlKey||local.multi?"toggle":"replace");
            }}
            {...{onKeyDown,onDoubleClick:onOpen?()=>onOpen(slide.id):undefined}}
            {...{className:joinClasses(styled&&"rounded-control border-2 focus-visible:ring-2 focus-visible:ring-focus",
              styled&&(on?"border-accent":"border-border"))}}
            style={{padding:tokens.spacing.off2,overflow:"hidden"}}>
            <SlideThumbnail slide={slide} width={cell-tokens.spacing.fixedElement} size={size} renderImage={renderImage} styled={styled}/>
            {on?<View {...{className:joinClasses(styled&&"bg-accent")}}
              style={{position:"absolute",top:tokens.spacing.off6,end:6,width:tokens.spacing.off20,height:tokens.spacing.off20,borderRadius:forgeRadius.sm,alignItems:"center",justifyContent:"center"}}>
              <View {...{className:joinClasses(styled&&"border-surface-raised")}}
                style={{width:tokens.spacing.fixedElement,height:tokens.spacing.off5,borderStartWidth:2,borderBottomWidth:tokens.borderWidth.strong,transform:[{rotate:"-45deg"}],marginTop:-tokens.spacing.off2}}/>
            </View>:null}
          </Pressable>
          <Text {...{className:muted}} style={{fontVariant:["tabular-nums"],textAlign:"center"}}>{index+1}</Text>
        </View>;
      }}/>
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
