import {useLayoutEffect,useRef} from 'react';
import {Platform,Pressable,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {PropertyRow} from '@nyc-tron/ui/components/shell/PropertyRow';
import {shellKey} from '@nyc-tron/ui/components/shell/shell-keys';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {combineObjectSelection,pickSelectionObject,selectionGroupState,sharedSelectionProperty,validateSelectableObjects,type ObjectSelection,type ObjectSelectionMode,type SelectableObject,type SharedValue} from './multi-selection-model.ts';
import { tokens } from '../tokens.ts';
export type {ObjectSelection,SelectableObject,SharedValue} from './multi-selection-model.ts';
export type SharedPropertyDefinition={readonly key:string;readonly label:string;readonly readOnly?:boolean}&(
 {readonly type:'number';readonly min:number;readonly max:number;readonly step:number}|
 {readonly type:'boolean'}|{readonly type:'choice';readonly options:readonly {value:string;label:string}[]}
);
export interface MultiSelectionControlsProps extends Omit<ViewProps,'children'> {
 scope:string;revision?:string|number;items:readonly SelectableObject[];selection:ObjectSelection;
 onSelectionChange:(selection:ObjectSelection)=>void;
 /** Lasso geometry is supplied by SelectionMarquee or the host's canvas hit-test owner. */
 tool:'pick'|'lasso';onToolChange:(tool:'pick'|'lasso')=>void;
 onGroup?:(request:{action:'group'|'ungroup';ids:readonly string[]})=>void;
 properties?:readonly SharedPropertyDefinition[];
 /** One transaction across the selected objects, never one callback per object. */
 onPropertyChange?:(request:{ids:readonly string[];key:string;value:SharedValue})=>void;
 disabled?:boolean;className?:string;unstyled?:boolean;
}
const definitionAccepts=(definition:SharedPropertyDefinition,value:SharedValue)=>definition.type==='boolean'?typeof value==='boolean':definition.type==='number'?typeof value==='number'&&Number.isFinite(value)&&value>=definition.min&&value<=definition.max:typeof value==='string'&&definition.options.some(option=>option.value===value);
/** Ordered range/toggle selection, group commands and honest shared-property state. */
export function MultiSelectionControls({scope,revision=0,items,selection,onSelectionChange,tool,onToolChange,onGroup,properties=[],onPropertyChange,disabled=false,className,unstyled=false,style,...rest}:MultiSelectionControlsProps){
 validateSelectableObjects(items,selection);
 if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512||!['pick','lasso'].includes(tool))throw new RangeError('Invalid multi-selection identity');
 const keys=new Set<string>();if(properties.length>128)throw new RangeError('Too many shared properties');for(const definition of properties){if(!definition.key.trim()||definition.key.length>512||keys.has(definition.key)||!definition.label.trim()||definition.label.length>512)throw new RangeError('Invalid shared property definition');keys.add(definition.key);if(!['number','boolean','choice'].includes(definition.type))throw new RangeError('Invalid shared property type');if(definition.type==='number'&&(![definition.min,definition.max,definition.step].every(Number.isFinite)||definition.max<definition.min||definition.step<=0)||definition.type==='choice'&&(!definition.options.length||definition.options.length>256||new Set(definition.options.map(o=>o.value)).size!==definition.options.length||definition.options.some(o=>!o.value.trim()||o.value.length>4096||!o.label.trim()||o.label.length>512)))throw new RangeError('Invalid shared property limits');}
 const boundary=JSON.stringify([scope,revision,items,selection,tool,properties,disabled]);
 const committed=useRef<null|{boundary:string;onSelectionChange:typeof onSelectionChange;onToolChange:typeof onToolChange;onGroup:typeof onGroup;onPropertyChange:typeof onPropertyChange}>(null);
 useLayoutEffect(()=>{committed.current={boundary,onSelectionChange,onToolChange,onGroup,onPropertyChange};});useLayoutEffect(()=>()=>{committed.current=null;},[]);
 const current=()=>!disabled&&committed.current?.boundary===boundary?committed.current:null;
 const group=selectionGroupState(items,selection),chosen=new Set(selection.ids);
 const pick=(id:string,shift=false,toggle=false)=>{const p=current();if(p)p.onSelectionChange(pickSelectionObject(items,selection,id,{shift,toggle}));};
 const combine=(mode:ObjectSelectionMode)=>{const p=current();if(p)p.onSelectionChange(combineObjectSelection(items,selection,items.filter(item=>!item.disabledReason).map(item=>item.id),mode,null));};
 const grouping=(action:'group'|'ungroup')=>{const p=current();if(p&&group[action])p.onGroup?.({action,ids:[...selection.ids]});};
 const property=(definition:SharedPropertyDefinition,value:SharedValue)=>{const p=current(),state=sharedSelectionProperty(items,selection,definition.key);if(p&&group.editable&&!definition.readOnly&&state.kind!=='missing'&&state.kind!=='empty'&&definitionAccepts(definition,value))p.onPropertyChange?.({ids:[...selection.ids],key:definition.key,value});};
 return <View {...rest} {...{className:joinClasses(className)}} style={[{gap:tokens.spacing.fixedElement},style]}>
  <SegmentedControl aria-label="Object selection tool" value={tool} options={[{value:'pick',label:'Pick'},{value:'lasso',label:'Lasso'}]} disabled={disabled} unstyled={unstyled} onChange={value=>{const p=current();if(p&&(value==='pick'||value==='lasso'))p.onToolChange(value);}}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}>{[['Select all objects','replace'],['Clear object selection','subtract'],['Invert object selection','toggle']].map(([title,mode])=><Button key={title} title={title!} variant="secondary" unstyled={unstyled} disabled={disabled||items.length===0} style={{minWidth:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedTarget}} onPress={()=>combine(mode as ObjectSelectionMode)}/>)}
   <Button title="Group selected objects" variant="secondary" disabled={disabled||!group.group||!onGroup} unstyled={unstyled} style={{minHeight:tokens.spacing.fixedTarget}} onPress={()=>grouping('group')}/><Button title="Ungroup selected objects" variant="secondary" disabled={disabled||!group.ungroup||!onGroup} unstyled={unstyled} style={{minHeight:tokens.spacing.fixedTarget}} onPress={()=>grouping('ungroup')}/>
  </View>
  <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text')}}>{selection.ids.length} objects selected</Text>
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Shift selects a range. Ctrl or Command toggles an object. Native users can add or remove with each row’s selection action.</Text>
  <View accessibilityRole="list" accessibilityLabel="Selectable objects" style={{gap:tokens.spacing.fixedStack}}>{items.map(item=>{const selected=chosen.has(item.id),off=disabled||!!item.disabledReason;return <View key={item.id} style={{flexDirection:'row',alignItems:'center',gap:tokens.spacing.fixedStack}}>
   <Pressable accessibilityRole="checkbox" accessibilityLabel={item.label} accessibilityHint={item.disabledReason??(item.readOnly?'Read only':undefined)} accessibilityState={{checked:selected,disabled:off}} aria-checked={selected} aria-disabled={off} disabled={off}
    {...{className:joinClasses(!unstyled&&'rounded-control border border-border focus-visible:ring-2 focus-visible:ring-focus',!unstyled&&(selected?'bg-surface-raised':'bg-surface-sunken'))}} style={{flex:1,minHeight:tokens.spacing.fixedTarget,minWidth:tokens.spacing.fixedTarget,padding:tokens.spacing.fixedElement,justifyContent:'center'}}
    accessibilityActions={off?[]:[{name:'activate'},{name:'toggle',label:selected?'Remove from selection':'Add to selection'},{name:'extend',label:'Extend selection range'}]}
    onAccessibilityAction={event=>{if(event.nativeEvent.actionName==='toggle')pick(item.id,false,true);else if(event.nativeEvent.actionName==='extend')pick(item.id,true);else if(event.nativeEvent.actionName==='activate')pick(item.id);}}
    onPress={event=>{const e=event as unknown as {shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean;nativeEvent:{shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean}};pick(item.id,!!(e.shiftKey??e.nativeEvent.shiftKey),!!(e.ctrlKey||e.metaKey||e.nativeEvent.ctrlKey||e.nativeEvent.metaKey));}}
    {...(Platform.OS==='web'?{onKeyDown:(event:unknown)=>{const key=shellKey(event);if(key.key===' '||key.key==='Enter'){key.preventDefault();pick(item.id,!!key.shiftKey,!!(key.ctrlKey||key.metaKey));}else if((key.ctrlKey||key.metaKey)&&key.key?.toLowerCase()==='a'){key.preventDefault();combine('replace');}}}:{})}>
    <Text {...{className:joinClasses(!unstyled&&'text-text')}}>{item.label}{item.kind==='group'?' (group)':''}{item.readOnly?' (read only)':''}</Text>
   </Pressable><Button title={(selected?'Remove ':'Add ')+item.label+(selected?' from selection':' to selection')} accessibilityLabel={(selected?'Remove ':'Add ')+item.label+(selected?' from selection':' to selection')} variant="ghost" disabled={off} unstyled={unstyled} style={{minWidth:tokens.spacing.fixedTarget,minHeight:tokens.spacing.fixedTarget,maxWidth:'45%'}} onPress={()=>pick(item.id,false,true)}/>
  </View>;})}</View>
  {properties.map(definition=>{const state=sharedSelectionProperty(items,selection,definition.key),selectedItems=items.filter(item=>chosen.has(item.id));const supported=state.kind!=='empty'&&state.kind!=='missing'&&selectedItems.every(item=>definitionAccepts(definition,item.properties[definition.key]!));const off=disabled||!group.editable||!!definition.readOnly||!onPropertyChange||!supported;
   const label=definition.label+(state.kind==='mixed'?', mixed values':state.kind==='missing'?', unavailable on part of the selection':state.kind==='empty'?', no selection':'');const value=state.kind==='value'?state.value:selectedItems[0]?.properties[definition.key];
   return <PropertyRow key={definition.key} label={definition.label} mixed={state.kind==='mixed'} disabled={off} unstyled={unstyled}>
    {definition.type==='number'?<UnitInput key={JSON.stringify([scope,revision,selection.ids,definition])} label={label} value={typeof value==='number'?value:definition.min} min={definition.min} max={definition.max} step={definition.step} disabled={off} unstyled={unstyled} onCommit={next=>property(definition,next)}/>:definition.type==='boolean'?<SettingSwitch label={label} on={value===true&&state.kind==='value'} disabled={off} styled={!unstyled} onChange={next=>property(definition,next)}/>:<Select label={label} value={state.kind==='mixed'?'':typeof value==='string'?value:''} options={[...state.kind!=='value'?[{value:'',label:state.kind==='mixed'?'Mixed values':'No shared value',disabled:true}]:[],...definition.options]} disabled={off} unstyled={unstyled} onValueChange={next=>property(definition,next)}/>}
   </PropertyRow>;
  })}
 </View>;
}
