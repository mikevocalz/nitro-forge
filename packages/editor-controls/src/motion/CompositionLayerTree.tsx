import {useLayoutEffect,useMemo,useRef,type ComponentRef} from 'react';
import {FlatList,Pressable,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {compositionAncestors,flattenCompositionLayers,validateCompositionLayers,type CompositionLayer,type CompositionTreeRow} from './composition-tree.ts';
import { tokens } from '../tokens.ts';
export type {CompositionLayer,CompositionLayerKind} from './composition-tree.ts';
export interface CompositionLayerTreeProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly revision?:string|number;readonly compositionId:string;readonly layers:readonly CompositionLayer[];readonly expandedIds:readonly string[];readonly selectedId:string|null;
 readonly onExpandedChange:(ids:readonly string[])=>void;readonly onSelect:(id:string)=>void;
 readonly onVisibilityChange:(id:string,visible:boolean,signal:AbortSignal)=>void|Promise<void>;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
const ROW=92;
/** Virtualized nested composition/shape/text/footage/adjustment hierarchy with stable layer identity. */
export function CompositionLayerTree({scope,revision=0,compositionId,layers,expandedIds,selectedId,onExpandedChange,onSelect,onVisibilityChange,height=320,disabled=false,unstyled=false,...props}:CompositionLayerTreeProps){
 useMemo(()=>validateCompositionLayers(layers,compositionId),[layers,compositionId]);if(!scope.trim()||!Number.isFinite(height)||height<100||height>4000||new Set(expandedIds).size!==expandedIds.length)throw new RangeError('Invalid composition tree scope, expansion or viewport');
 const action=useOwnedAction(JSON.stringify([scope,compositionId,revision])),pending=action.pending!==null,rows=useMemo(()=>flattenCompositionLayers(layers,expandedIds),[layers,expandedIds]);
 const list=useRef<ComponentRef<typeof FlatList<CompositionTreeRow>>|null>(null),reveal=useRef<string|null>(null);
 useLayoutEffect(()=>{if(!reveal.current)return;const index=rows.findIndex(row=>row.layer.id===reveal.current);if(index<0)return;reveal.current=null;list.current?.scrollToIndex({index,animated:false});},[rows]);
 const expand=(id:string)=>{if(disabled)return;onExpandedChange(expandedIds.includes(id)?expandedIds.filter(value=>value!==id):[...expandedIds,id]);};
 const revealSelected=()=>{if(disabled||!selectedId||!layers.some(layer=>layer.id===selectedId))return;reveal.current=selectedId;const next=[...new Set([...expandedIds,...compositionAncestors(layers,selectedId)])];onExpandedChange(next);const index=rows.findIndex(row=>row.layer.id===selectedId);if(index>=0){reveal.current=null;list.current?.scrollToIndex({index,animated:false});}};
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Button title="Reveal selected composition layer" disabled={disabled||!selectedId||!layers.some(layer=>layer.id===selectedId)} unstyled={unstyled} onPress={revealSelected}/>
  <FlatList ref={list} data={rows} keyExtractor={row=>row.layer.id} style={{height}} initialNumToRender={8} windowSize={5} getItemLayout={(_,index)=>({length:ROW,offset:ROW*index,index})} extraData={[selectedId,expandedIds,pending,disabled]} accessibilityLabel="Composition layer tree"
   ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>This composition has no layers</Text>}
   renderItem={({item})=>{const layer=item.layer,expanded=expandedIds.includes(layer.id);return <View style={{height:ROW,paddingLeft:Math.min(item.depth,6)*tokens.spacing.fixedInset,flexDirection:'row',alignItems:'center',gap:tokens.spacing.fixedStack}}>
    {layer.kind==='composition'?<Button title={expanded?'−':'+'} accessibilityLabel={`${expanded?'Collapse':'Expand'} ${layer.name}`} disabled={disabled||!item.hasChildren} unstyled={unstyled} onPress={()=>expand(layer.id)}/>:<View style={{width:tokens.spacing.fixedTarget}}/>}
    <Pressable accessibilityRole="button" accessibilityLabel={`Select ${layer.name}, ${layer.kind}, level ${item.depth+1}${layer.locked?', locked':''}`} accessibilityState={{selected:layer.id===selectedId,disabled}} disabled={disabled} onPress={()=>{if(!disabled)onSelect(layer.id);}} style={{flex:1,minWidth:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedHeader,justifyContent:'center',gap:tokens.spacing.off2}}>
     <Text numberOfLines={2} {...{className:joinClasses(!unstyled&&'text-text')}}>{layer.name}</Text><Text numberOfLines={1} {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{`${layer.kind} · ${Math.round(layer.opacity*100)}%${layer.locked?' · locked':''}`}</Text>
    </Pressable>
    <Button title={layer.visible?'Hide':'Show'} accessibilityLabel={`${layer.visible?'Hide':'Show'} ${layer.name}`} disabled={disabled||pending} unstyled={unstyled} onPress={()=>{if(!disabled&&!pending)void action.run(layer.id,signal=>onVisibilityChange(layer.id,!layer.visible,signal));}}/>
   </View>;}}/>
  {pending?<Button title="Cancel layer visibility request" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
