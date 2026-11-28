import {useLayoutEffect,useRef} from 'react';
import {TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {parsePhotoPreset,serializePhotoPreset,validatePhotoPresets,type PhotoPreset} from './photo-presets.ts';
import { tokens } from '../tokens.ts';
export type {PhotoPreset} from './photo-presets.ts';
export interface PresetManagerProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly presets:readonly PhotoPreset[];readonly selectedId:string|null;readonly onSelect:(id:string)=>void;
 readonly onRename:(id:string,name:string,signal:AbortSignal)=>void|Promise<void>;
 readonly onDelete:(id:string,signal:AbortSignal)=>void|Promise<void>;
 readonly onReadImport:(signal:AbortSignal)=>string|Promise<string>;
 readonly onImport:(preset:PhotoPreset,signal:AbortSignal)=>void|Promise<void>;
 readonly onExport:(payload:string,signal:AbortSignal)=>void|Promise<void>;
 readonly disabled?:boolean;readonly unstyled?:boolean;
}
const makeStore=()=>createStore(()=>({name:null as string|null}));
/** Versioned preset transfer with validation before any host write, plus rename/delete. */
export function PresetManager({scope,presets,selectedId,onSelect,onRename,onDelete,onReadImport,onImport,onExport,disabled=false,unstyled=false,...props}:PresetManagerProps){
 validatePhotoPresets(presets);if(!scope.trim())throw new TypeError('Preset library requires a scope');
 const action=useOwnedAction(scope),locked=disabled||action.pending!==null,selected=presets.find(p=>p.id===selectedId);
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 useLayoutEffect(()=>{store.setState({name:null});},[scope,selectedId,store]);
 const name=s.name??selected?.name??'';
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Select label="Managed photo preset" value={selectedId??''} options={presets.map(p=>({value:p.id,label:p.name}))} placeholder="Select a photo preset" disabled={locked} unstyled={unstyled} onValueChange={id=>{if(!locked)onSelect(id);}}/>
  <TextInput accessibilityLabel="Photo preset name" value={name} maxLength={256} editable={!locked&&!!selected} aria-disabled={locked||!selected} onChangeText={name=>store.setState({name})} style={{minHeight:tokens.spacing.fixedTarget,padding:tokens.spacing.fixedElement}} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control')}}/>
  <Button title="Rename photo preset" disabled={locked||!selected||!name.trim()||name===selected.name} unstyled={unstyled} onPress={()=>{if(!locked&&selected&&name.trim())void action.run('rename',signal=>onRename(selected.id,name.trim(),signal));}}/>
  <Button title="Delete photo preset" disabled={locked||!selected} unstyled={unstyled} onPress={()=>{if(!locked&&selected)void action.run('delete',signal=>onDelete(selected.id,signal));}}/>
  <Button title="Import photo preset" disabled={locked} unstyled={unstyled} onPress={()=>{if(locked)return;void action.run('import',async signal=>{const preset=parsePhotoPreset(await onReadImport(signal));if(signal.aborted)return;if(presets.some(p=>p.id===preset.id))throw new Error('A preset with this identity already exists');await onImport(preset,signal);});}}/>
  <Button title="Export photo preset" disabled={locked||!selected} unstyled={unstyled} onPress={()=>{if(!locked&&selected)void action.run('export',signal=>onExport(serializePhotoPreset(selected),signal));}}/>
  {action.pending!==null?<Button title="Cancel preset transfer" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
