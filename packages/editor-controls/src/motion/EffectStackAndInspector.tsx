import {useMemo,useId} from 'react';
import {FlatList,ScrollView,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {TextField} from '@nyc-tron/ui/components/TextField';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {moveMotionEffect,validateMotionEffects,validateEffectChoices,validateEffectParameterValue,type MotionEffect,type MotionEffectMutation,type EffectParameterValue} from './motion-effects.ts';
export type {MotionEffect,MotionEffectMutation,EffectParameter,EffectParameterValue} from './motion-effects.ts';
export interface EffectStackAndInspectorProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly revision:string|number;readonly effects:readonly MotionEffect[];readonly selectedId:string|null;readonly onSelect:(id:string)=>void;
 readonly availableEffects:readonly {readonly id:string;readonly label:string}[];
 readonly onMutation:(mutation:MotionEffectMutation,signal:AbortSignal)=>void|Promise<void>;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Host-controlled effect order and schema-driven settings. Processing and preset storage stay with the host. */
export function EffectStackAndInspector({scope,revision,effects,selectedId,onSelect,availableEffects,onMutation,height=320,disabled=false,unstyled=false,...props}:EffectStackAndInspectorProps){
 useMemo(()=>validateMotionEffects(effects),[effects]);useMemo(()=>validateEffectChoices(availableEffects),[availableEffects]);if(!scope.trim()||typeof revision==='number'&&!Number.isFinite(revision)||!Number.isFinite(height)||height<100||height>4000)throw new RangeError('Invalid effect stack scope or viewport');
 const [local,store]=useLocalStore(()=>({section:'stack',favorites:false}));const action=useOwnedAction(JSON.stringify([scope,revision])),locked=disabled||action.pending!==null,selected=effects.find(e=>e.id===selectedId);
 const run=(mutation:MotionEffectMutation)=>{if(!locked)void action.run(mutation.type,signal=>onMutation(mutation,signal));};
 const parameter=(parameterId:string,value:EffectParameterValue)=>{if(!selected||locked)return;const p=selected.parameters.find(p=>p.id===parameterId);if(!p)return;validateEffectParameterValue(p,value);run({type:'parameter',effectId:selected.id,parameterId,value});};
 return <View {...props} style={[{gap:8},props.style]}>
  <SegmentedControl accessibilityLabel="Effect panel section" options={['stack','inspector','library'].map(value=>({value,label:value==='stack'?'Effect stack':value==='inspector'?'Effect inspector':'Effect library'}))} value={local.section} onChange={section=>store.set(s=>({...s,section}))} unstyled={unstyled}/>
  {local.section==='stack'?<><SettingSwitch label="Favorite effects only" on={local.favorites} onChange={favorites=>store.set(s=>({...s,favorites}))} disabled={disabled} styled={!unstyled}/>
   <FlatList data={local.favorites?effects.filter(e=>e.favorite):effects} keyExtractor={e=>e.id} style={{height}} initialNumToRender={6} windowSize={5} extraData={[locked,selectedId]} accessibilityLabel="Ordered effect stack" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No matching effects</Text>}
    renderItem={({item})=>{const index=effects.indexOf(item);return <View style={{gap:6,padding:8}}><Button title={item.label} accessibilityLabel={`Inspect ${item.label}`} disabled={disabled} unstyled={unstyled} onPress={()=>{if(!disabled){onSelect(item.id);store.set(s=>({...s,section:'inspector'}));}}}/>
     <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{`${index+1}. ${item.typeId}${item.bypassed?' · bypassed':''}`}</Text>
     <SettingSwitch label={`Bypass ${item.label}`} on={item.bypassed} disabled={locked} styled={!unstyled} onChange={value=>run({type:'bypass',effectId:item.id,value})}/>
     <SettingSwitch label={`Favorite ${item.label}`} on={item.favorite} disabled={locked} styled={!unstyled} onChange={value=>run({type:'favorite',effectId:item.id,value})}/>
     <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{([-1,1] as const).map(direction=><Button key={direction} title={direction===-1?'Earlier':'Later'} accessibilityLabel={`Move ${item.label} ${direction===-1?'earlier':'later'}`} disabled={locked||index===(direction===-1?0:effects.length-1)} unstyled={unstyled} onPress={()=>run({type:'reorder',ids:moveMotionEffect(effects,item.id,direction)})}/>)}<Button title={`Remove ${item.label}`} disabled={locked} unstyled={unstyled} onPress={()=>run({type:'remove',effectId:item.id})}/></View>
    </View>;}}/></>:null}
  {local.section==='inspector'?<ScrollView style={{height}} contentContainerStyle={{gap:8}} keyboardShouldPersistTaps="handled">{selected?<View key={JSON.stringify([scope,selected.id])} style={{gap:8}}><Text accessibilityRole="header" {...{className:joinClasses(!unstyled&&'text-text')}}>{selected.label}</Text>
   <Button title={`Reset ${selected.label}`} disabled={locked} unstyled={unstyled} onPress={()=>run({type:'reset',effectId:selected.id})}/>
   {selected.presets.length?<Select label={`Preset for ${selected.label}`} value={selected.presetId??''} options={[{value:'',label:'Custom settings',disabled:true},...selected.presets.map(p=>({value:p.id,label:p.label})),...(selected.presetId&&!selected.presets.some(p=>p.id===selected.presetId)?[{value:selected.presetId,label:`Unavailable: ${selected.presetId}`,disabled:true}]:[])]} disabled={locked} unstyled={unstyled} onValueChange={presetId=>run({type:'preset',effectId:selected.id,presetId})}/>:<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No presets supplied for this effect</Text>}
   {selected.parameters.map(p=><View key={p.id}>{p.kind==='number'?<UnitInput scope={JSON.stringify([scope,revision,selected.id,p.id])} label={p.unit?`${p.label} (${p.unit})`:p.label} value={p.value} min={p.minimum} max={p.maximum} step={p.step} disabled={locked} unstyled={unstyled} onCommit={value=>parameter(p.id,value)}/>:p.kind==='boolean'?<SettingSwitch label={p.label} on={p.value} disabled={locked} styled={!unstyled} onChange={value=>parameter(p.id,value)}/>:p.kind==='choice'?<Select label={p.label} value={p.value} options={[...p.choices.map(c=>({value:c.id,label:c.label})),...(!p.choices.some(c=>c.id===p.value)?[{value:p.value,label:`Unavailable: ${p.value}`,disabled:true}]:[])]} disabled={locked} unstyled={unstyled} onValueChange={value=>parameter(p.id,value)}/>:<EffectTextField key={JSON.stringify([scope,revision,selected.id,p.id])} label={p.label} value={p.value} maxLength={p.maxLength} disabled={locked} unstyled={unstyled} onApply={value=>parameter(p.id,value)}/>}</View>)}
  </View>:<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Select an effect to inspect</Text>}</ScrollView>:null}
  {local.section==='library'?<FlatList data={availableEffects} keyExtractor={e=>e.id} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Available effect types" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No effect types supplied</Text>} renderItem={({item})=><Button title={`Add ${item.label}`} disabled={locked||effects.length>=256} unstyled={unstyled} onPress={()=>run({type:'add',typeId:item.id})}/>}/>:null}
  {action.pending!==null?<Button title="Cancel effect request" unstyled={unstyled} onPress={action.cancel}/>:null}<ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}

function EffectTextField({label,value,maxLength,disabled,unstyled,onApply}:{label:string;value:string;maxLength:number;disabled:boolean;unstyled:boolean;onApply:(value:string)=>void}){const id=useId(),[local,store]=useLocalStore(()=>({draft:value}));return <View style={{gap:6}}><TextField id={id} label={label} value={local.draft} maxLength={maxLength} editable={!disabled} unstyled={unstyled} onChangeText={draft=>store.set({draft})}/><Button title={`Apply ${label}`} disabled={disabled||local.draft===value} unstyled={unstyled} onPress={()=>{if(!disabled&&local.draft.length<=maxLength)onApply(local.draft);}}/></View>;}
