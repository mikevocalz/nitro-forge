import {useLayoutEffect,useRef} from 'react';
import {View,Text,TextInput,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {Select} from '@nyc-tron/ui/components/Select';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {controlIdentity,useScopedControl,type ScopedControlProps} from './useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export type PropertyValue=number|string|boolean;
export type InspectorProperty={id:string;label:string;disabledReason?:string|undefined}&(
 {kind:'number';value:number;min:number;max:number;step:number;unit?:string;integer?:boolean}|
 {kind:'choice';value:string;choices:readonly {id:string;label:string;disabled?:boolean}[]}|
 {kind:'boolean';value:boolean}|
 {kind:'text';value:string;maxLength:number;multiline?:boolean});
export interface PropertyInspectorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 label:string;fields:readonly InspectorProperty[];onCommit:(id:string,value:PropertyValue,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function validateInspectorFields(fields:readonly InspectorProperty[]):void{
 if(fields.length>128||new Set(fields.map(f=>f.id)).size!==fields.length)throw new RangeError('Invalid inspector field roster');
 for(const f of fields){
  if(!f.id.trim()||f.id.length>256||!f.label.trim()||f.label.length>1024)throw new RangeError('Invalid inspector field identity');
  if(f.kind==='number'&&(![f.value,f.min,f.max,f.step].every(Number.isFinite)||f.min>=f.max||f.step<=0||f.value<f.min||f.value>f.max||f.integer&&!Number.isInteger(f.value))||f.kind==='text'&&(!Number.isInteger(f.maxLength)||f.maxLength<1||f.maxLength>65536||f.value.length>f.maxLength)||f.kind==='choice'&&(f.choices.length>512||new Set(f.choices.map(c=>c.id)).size!==f.choices.length||f.choices.some(c=>!c.id.trim()||c.id.length>512||!c.label.trim()||c.label.length>1024)))throw new RangeError('Invalid inspector property');
 }
}
/** Shared bounded field owner; document validation and engine mutations remain in each typed caller. */
export function PropertyInspector({scope='property-inspector',revision=0,...props}:PropertyInspectorProps){
 const {label,fields,onCommit:_commit,disabledReason,unstyled=false,style,...rest}=props;validateInspectorFields(fields);if(!label.trim()||label.length>1024)throw new RangeError('Invalid inspector label');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),label,disabledReason,fields.map(({value:_value,...schema})=>schema)])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const change=(id:string,value:PropertyValue)=>guard.run(id,(h,s)=>{const f=h.fields.find(f=>f.id===id);if(!f||f.disabledReason!==undefined)return;if(f.kind==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<f.min||value>f.max||f.integer&&!Number.isInteger(value))||f.kind==='choice'&&(typeof value!=='string'||!f.choices.some(c=>c.id===value&&!c.disabled))||f.kind==='boolean'&&typeof value!=='boolean'||f.kind==='text'&&(typeof value!=='string'||value.length>f.maxLength))throw new RangeError('Property value is unavailable');return h.onCommit(id,value,s);});
 return <View {...rest} accessibilityLabel={label} style={[{gap:10,minWidth:0},style]}>
  <Text accessibilityRole="header" {...{className:unstyled?undefined:'text-text'}}>{label}</Text>
  {fields.map(f=><View key={f.id} style={{gap:4}}>{f.kind==='number'?<UnitInput scope={owner+':'+f.id} label={f.unit?f.label+' ('+f.unit+')':f.label} value={f.value} min={f.min} max={f.max} step={f.step} disabled={off||f.disabledReason!==undefined} unstyled={unstyled} onCommit={n=>change(f.id,n)}/>:f.kind==='choice'?<Select label={f.label} value={f.value} options={[...f.choices.map(c=>exact({value:c.id,label:c.label,disabled:c.disabled})),...(!f.choices.some(c=>c.id===f.value)?[{value:f.value,label:'Unavailable: '+f.value,disabled:true}]:[])]} disabled={off||f.disabledReason!==undefined||f.choices.length===0} unstyled={unstyled} onValueChange={v=>change(f.id,v)}/>:f.kind==='boolean'?<Button title={f.label+': '+(f.value?'on':'off')} variant="secondary" accessibilityState={{checked:f.value}} disabled={off||f.disabledReason!==undefined} unstyled={unstyled} onPress={()=>change(f.id,!f.value)}/>:<InspectorText key={owner+f.id} field={f} disabled={off||f.disabledReason!==undefined} unstyled={unstyled} onApply={v=>change(f.id,v)}/>}
   {f.disabledReason?<Text {...{className:unstyled?undefined:'text-text-muted'}}>{f.disabledReason}</Text>:null}
  </View>)}
  <ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
function InspectorText({field,disabled,unstyled,onApply}:{field:Extract<InspectorProperty,{kind:'text'}>;disabled:boolean;unstyled:boolean;onApply:(value:string)=>unknown}){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(field.value);const store=local.current,value=useStore(store,s=>s.value);
 useLayoutEffect(()=>{store.setState({value:field.value});},[field.value]);
 return <View style={{gap:6}}><Text {...{className:unstyled?undefined:'text-text'}}>{field.label}</Text><TextInput accessibilityLabel={field.label} value={value} multiline={field.multiline} maxLength={field.maxLength} editable={!disabled} onChangeText={value=>store.setState({value})} style={{minHeight:44,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/><Button title={'Apply '+field.label} disabled={disabled||value===field.value} unstyled={unstyled} onPress={()=>onApply(value)}/></View>;
}
function makeStore(value:string){return createStore(()=>({value}));}
