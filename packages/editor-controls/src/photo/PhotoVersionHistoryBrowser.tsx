import {useLayoutEffect,useMemo} from 'react';
import {FlatList,Pressable,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {validatePhotoDevelop,type PhotoDevelopSettings} from './photo-adjustments.ts';
export interface PhotoVersion {readonly id:string;readonly name:string;readonly timestampMs:number;readonly settings:PhotoDevelopSettings}
export interface PhotoVersionHistoryBrowserProps extends Omit<ViewProps,'children'> {
 readonly photoId:string;readonly revision:string;readonly versions:readonly PhotoVersion[];readonly originalVersionId:string|null;readonly selectedId:string|null;readonly currentId:string|null;
 readonly onSelect:(id:string)=>void;readonly onCompare:(version:PhotoVersion|undefined)=>void;
 readonly onRestore:(version:PhotoVersion,signal:AbortSignal)=>void|Promise<void>;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Read-only snapshots with explicit compare/restore; there is no original-delete operation. */
export function PhotoVersionHistoryBrowser({photoId,revision,versions,originalVersionId,selectedId,currentId,onSelect,onCompare,onRestore,height=320,disabled=false,unstyled=false,...props}:PhotoVersionHistoryBrowserProps){
 const byId=useMemo(()=>{if(versions.length>10000)throw new RangeError('Photo version page exceeds 10,000 snapshots');const map=new Map<string,PhotoVersion>();for(const version of versions){if(!version.id.trim()||!version.name.trim()||version.name.length>256||!Number.isFinite(version.timestampMs)||!Number.isFinite(new Date(version.timestampMs).getTime())||map.has(version.id))throw new TypeError('Invalid photo version identity or timestamp');validatePhotoDevelop(version.settings);map.set(version.id,version);}return map;},[versions]);
 if(!photoId.trim()||!Number.isFinite(height)||height<100||height>4000||originalVersionId!==null&&!byId.has(originalVersionId))throw new RangeError('Invalid photo version scope, original or bounds');
 const action=useOwnedAction(JSON.stringify([photoId,revision])),locked=disabled||action.pending!==null,selected=selectedId===null?undefined:byId.get(selectedId),original=originalVersionId===null?undefined:byId.get(originalVersionId);
 useLayoutEffect(()=>()=>onCompare(undefined),[photoId,revision]);
 const restore=(version:PhotoVersion)=>{if(!locked&&version.id!==currentId)void action.run('restore',signal=>onRestore(version,signal));};
 return <View {...props} style={[{gap:8},props.style]}>
  <FlatList data={versions} keyExtractor={version=>version.id} initialNumToRender={10} windowSize={5} style={{height}} accessibilityLabel="Photo edit versions" extraData={[selectedId,currentId,locked,originalVersionId]}
   ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No photo versions supplied</Text>}
   renderItem={({item})=><Pressable accessibilityRole="radio" accessibilityLabel={`${item.name}${item.id===originalVersionId?', original':''}${item.id===currentId?', current':''}`} accessibilityState={{checked:item.id===selectedId,disabled:locked}} aria-checked={item.id===selectedId} disabled={locked} onPress={()=>{if(!locked)onSelect(item.id);}} style={{minHeight:56,padding:8,gap:4}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{item.name}</Text><Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{new Date(item.timestampMs).toLocaleString()}</Text></Pressable>}/>
  <Button title="Compare selected photo version" disabled={locked||!selected} unstyled={unstyled} onPress={()=>{if(!locked&&selected)onCompare(selected);}}/>
  <Button title="Close photo version comparison" unstyled={unstyled} onPress={()=>onCompare(undefined)}/>
  <Button title="Restore selected photo version" disabled={locked||!selected||selected.id===currentId} unstyled={unstyled} onPress={()=>{if(selected)restore(selected);}}/>
  <Button title="Restore original photo settings" disabled={locked||!original||original.id===currentId} unstyled={unstyled} onPress={()=>{if(original)restore(original);}}/>
  {!original?<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Original settings have not been supplied</Text>:null}
  {action.pending!==null?<Button title="Cancel photo version restore" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
