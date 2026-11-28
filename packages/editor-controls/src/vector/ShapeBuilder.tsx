import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useScopedControl,controlIdentity,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEffect,useRef} from "react";
import {Pressable,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {
  BOOLEAN_OPS,booleanAvailability,booleanIds,groupAvailability,layerKindName,
  operandAccessibilityLabel,validateBooleanGroup,
  type BooleanGroup,type BuilderLayer,type LayerId,
} from "./shape-builder-model.ts";
import {availabilityReason,type BooleanOp} from "./vector-types.ts";
import {GroupLabel,NoticeLine,VECTOR_TOUCH_TARGET,VectorButton} from "./vector-controls.tsx";
import {exact} from '../exact-optional.ts';

/** Props for {@linkcode ShapeBuilder}. Selection and the boolean group come from the host's document. */
export interface ShapeBuilderProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The selected layers. Two or more sibling, unlocked shapes or paths can be combined. */
  selection:readonly BuilderLayer[];
  /** The boolean group to edit: the selected boolean, or the boolean holding the selected operand. */
  group?:BooleanGroup;
  /** Combine the selection. Maps to `booleanLayers {ids, op}`. */
  onBoolean:(intent:{ids:LayerId[];op:BooleanOp},signal?:AbortSignal)=>void|Promise<unknown>;
  /** Change the group's operation. Maps to `setBooleanOp {id, op}`. */
  onSetBooleanOp:(intent:{id:LayerId;op:BooleanOp},signal?:AbortSignal)=>void|Promise<unknown>;
  /** Release the operands back into the parent. Maps to `ungroupLayer {id}`. */
  onRelease:(intent:{id:LayerId},signal?:AbortSignal)=>void|Promise<unknown>;
  /** Expand the result into pixels. Maps to `rasterizeLayer {id}`. */
  onExpand:(intent:{id:LayerId},signal?:AbortSignal)=>void|Promise<unknown>;
  /** An operand row was pressed; the host selects that layer for editing (`selectLayers`). Rows are static text without it. */
  onSelectOperand?:(id:LayerId)=>void;
  className?:string;
  unstyled?:boolean;
}
type Local={notice:string|undefined};

/**
 * Boolean shape builder (B-22). Combines two or more selected shapes or paths
 * with union, subtract, intersect or exclude; each command that cannot run
 * says why. When a boolean group is in focus it lists the operands (they stay
 * editable layers), switches the operation, releases the operands or expands
 * the result into pixels.
 */
export function ShapeBuilder({scope='shape-builder',revision=0,...props}:ShapeBuilderProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.selection,props.group]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <ShapeBuilderBody key={owner} {...props} actionError={guard.error} busy={guard.pending}
  onBoolean={value=>guard.run('onBoolean',(host,signal)=>host.onBoolean(value,signal))}
  onSetBooleanOp={value=>guard.run('onSetBooleanOp',(host,signal)=>host.onSetBooleanOp(value,signal))}
  onRelease={value=>guard.run('onRelease',(host,signal)=>host.onRelease(value,signal))}
  onExpand={value=>guard.run('onExpand',(host,signal)=>host.onExpand(value,signal))}
  {...(props.onSelectOperand?{onSelectOperand:(id:Parameters<NonNullable<ShapeBuilderProps['onSelectOperand']>>[0])=>guard.current()?.onSelectOperand?.(id)}:{})}/>;
}
function ShapeBuilderBody({
  actionError=null,busy=false,disabledReason,
  selection,group,onBoolean,onSetBooleanOp,onRelease,onExpand,onSelectOperand,className,unstyled=false,style,...rest
}:ShapeBuilderProps&{actionError?:string|null;busy?:boolean}){
  if(group)validateBooleanGroup(group);
  const local=useRef<StoreApi<Local>|null>(null);
  if(!local.current)local.current=createStore<Local>(()=>({notice:undefined}));
  const store=local.current;
  const notice=useStore(store,s=>s.notice);
  const styled=!unstyled;
  const contextKey=JSON.stringify([selection.map(l=>[l.id,l.kind,l.parent,l.parentKind,l.locked]),group?.id,group?.locked]);
  useEffect(()=>{store.setState({notice:undefined});},[contextKey,store]);
  const block=(reason:string)=>store.setState({notice:reason});
  const ok=(run:()=>void)=>()=>{store.setState({notice:undefined});run();};
  const combineReason=disabledReason??(busy?"Applying change":availabilityReason(booleanAvailability(selection)));
  const groupReason=disabledReason??(busy?"Applying change":availabilityReason(groupAvailability(group)));
  const muted=joinClasses(styled&&"text-text-muted text-xs");
  const text=joinClasses(styled&&"text-text");
  return <View {...rest} {...{className:joinClasses("gap-3",styled&&"rounded-control border border-border bg-surface-raised p-3",className)}}
    style={[{minWidth:0},style]}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    {disabledReason||busy?<Text accessibilityLiveRegion="polite">{disabledReason??"Applying change"}</Text>:null}
    <View style={{gap:6}}>
      <GroupLabel styled={styled}>Combine shapes</GroupLabel>
      <Text {...{className:muted}}>{selection.length===1?"1 layer selected":`${selection.length} layers selected`}</Text>
      <View accessibilityRole="toolbar" aria-label="Boolean operations" style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
        {BOOLEAN_OPS.map(op=><VectorButton key={op.value} label={op.label} styled={styled} reason={combineReason}
          testID={"combine-"+op.value} onBlocked={block}
          onPress={ok(()=>onBoolean({ids:booleanIds(selection),op:op.value}))}>
          <OpGlyph op={op.value} styled={styled} inverse={false}/>
        </VectorButton>)}
      </View>
    </View>
    {group?<View style={{gap:6}} testID="boolean-group">
      <GroupLabel styled={styled}>{`Boolean: ${group.name}`}</GroupLabel>
      <Text {...{className:muted}}>{BOOLEAN_OPS.find(o=>o.value===group.op)!.description}</Text>
      <View role="radiogroup" aria-label="Operation" style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
        {BOOLEAN_OPS.map(op=><VectorButton key={op.value} role="radio" checked={group.op===op.value} label={op.label}
          styled={styled} reason={groupReason} onBlocked={block}
          onPress={ok(()=>{if(group.op!==op.value)onSetBooleanOp({id:group.id,op:op.value});})}>
          <OpGlyph op={op.value} styled={styled} inverse={group.op===op.value}/>
        </VectorButton>)}
      </View>
      <View role="list" aria-label={`Operands of ${group.name}`}
        {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken")}}>
        {group.operands.length===0?<Text {...{className:muted}} style={{padding:12}}>No operands</Text>
          :group.operands.map((operand,i)=>{
            const body=<>
              <Text numberOfLines={1} {...{className:text}} style={{fontWeight:"500"}}>{operand.name}</Text>
              <Text numberOfLines={1} {...{className:muted}}>
                {[layerKindName(operand.kind),i===group.operands.length-1?"bottom":i===0?"top":undefined,operand.locked?"locked":undefined]
                  .filter(Boolean).join(", ")}
              </Text>
            </>;
            const rowStyle={minHeight:VECTOR_TOUCH_TARGET,justifyContent:"center" as const,paddingHorizontal:12,paddingVertical:4};
            const divider=joinClasses(styled&&i>0&&"border-t border-border");
            return onSelectOperand
              ?<Pressable key={operand.id} role="listitem" accessibilityLabel={operandAccessibilityLabel(operand,i,group.operands.length)}
                accessibilityHint="Selects this shape for editing" onPress={()=>onSelectOperand(operand.id)}
                {...{className:joinClasses(divider,styled&&"focus-visible:ring-2 focus-visible:ring-focus")}} style={rowStyle}>
                {body}
              </Pressable>
              :<View key={operand.id} role="listitem" accessible
                accessibilityLabel={operandAccessibilityLabel(operand,i,group.operands.length)}
                {...{className:divider}} style={rowStyle}>{body}</View>;
          })}
      </View>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
        <VectorButton label="Release" styled={styled} reason={groupReason} onBlocked={block}
          onPress={ok(()=>onRelease({id:group.id}))}/>
        <VectorButton label="Expand to pixels" styled={styled} reason={groupReason} onBlocked={block}
          onPress={ok(()=>onExpand({id:group.id}))}/>
      </View>
    </View>:null}
    <NoticeLine styled={styled} testID="builder-notice"
      text={notice??(combineReason&&!group?combineReason:undefined)}/>
  </View>;
}

/**
 * Two overlapping squares showing the operation: union fills both, subtract
 * cuts the front one out of the back, intersect fills the overlap only,
 * exclude fills everything but the overlap. Drawn with views and tokens.
 */
function OpGlyph({op,styled,inverse}:{op:BooleanOp;styled:boolean;inverse:boolean}){
  const ink=joinClasses(styled&&(inverse?"bg-on-primary":"bg-text"));
  const inkBorder=joinClasses(styled&&(inverse?"border-on-primary":"border-text"));
  const paper=joinClasses(styled&&(inverse?"bg-primary":"bg-surface-raised"));
  const square=(left:number,top:number,filled:boolean)=><View
    {...{className:joinClasses(filled?ink:paper,inkBorder)}}
    style={{position:"absolute",left,top,width:12,height:12,borderWidth:1.5}}/>;
  const overlap=(cls:string)=><View {...{className:cls}} style={{position:"absolute",left:7,top:5,width:6,height:8}}/>;
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    {...{"aria-hidden":true}} style={{width:20,height:17}}>
    {square(0,0,op!=="intersect")}
    {square(7,5,op==="union"||op==="exclude")}
    {op==="intersect"?overlap(ink):op==="exclude"?overlap(paper):null}
  </View>;
}

