import {useLayoutEffect,useRef} from 'react';
import {FlatList,Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import type {SheetSort,SheetFilter} from './SortFilterHeader.tsx';
import type {FreezeState} from './freeze-split-model.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface SheetViewSnapshot {visibleColumns:readonly string[];sorts:readonly SheetSort[];filters:readonly SheetFilter[];freeze:FreezeState;zoom:number}
export interface SavedSheetView {id:string;sheetId:string;name:string;visibility:'personal'|'shared';canEdit:boolean;summary:string}
export interface SavedSheetViewManagerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sheetId:string;views:readonly SavedSheetView[];activeId:string|null;snapshot:SheetViewSnapshot;
 onSave:(name:string,snapshot:SheetViewSnapshot,signal?:AbortSignal)=>unknown;onRestore:(id:string,signal?:AbortSignal)=>unknown;
 onRename:(id:string,name:string,signal?:AbortSignal)=>unknown;onDelete:(id:string,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function SavedSheetViewManager({scope='saved-sheet-views',revision=0,...props}:SavedSheetViewManagerProps){
 const {sheetId,views,activeId,snapshot,onSave:_save,onRestore:_restore,onRename:_rename,onDelete:_delete,unstyled=false,disabledReason,style,...rest}=props;
 if(!sheetId.trim()||sheetId.length>256||views.length>1024||new Set(views.map(v=>v.id)).size!==views.length||views.some(v=>!v.id.trim()||v.id.length>256||!v.name.trim()||v.name.length>256||v.summary.length>8192)||snapshot.visibleColumns.length>16384||snapshot.sorts.length>512||snapshot.filters.length>512||!Number.isFinite(snapshot.zoom)||snapshot.zoom<.1||snapshot.zoom>4||![snapshot.freeze.frozenRows,snapshot.freeze.frozenColumns].every(n=>Number.isSafeInteger(n)&&n>=0))throw new RangeError('Invalid saved sheet view');
 const owner=JSON.stringify([...controlIdentity(scope,revision),sheetId,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v);
 useLayoutEffect(()=>{store.setState({name:'',renameId:null,discardId:null});},[owner]);
 const name=s.name.trim(),discard=views.find(v=>v.id===s.discardId&&v.sheetId===sheetId),rename=views.find(v=>v.id===s.renameId&&v.sheetId===sheetId);
 return <View {...rest} accessibilityLabel="Saved sheet views" style={[{gap:8},style]}><TextInput accessibilityLabel={rename?'New name for '+rename.name:'Name for current sheet view'} value={s.name} maxLength={256} editable={!off} onChangeText={name=>store.setState({name})} style={{minHeight:44,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
 <Button title={rename?'Apply view name':'Save current sheet view'} disabled={off||!name} unstyled={unstyled} onPress={()=>guard.run('save',async(h,signal)=>{if(h.views.some(v=>v.sheetId===h.sheetId&&v.name.toLocaleLowerCase()===name.toLocaleLowerCase()&&v.id!==rename?.id))throw new Error('A view already uses this name');if(rename){if(!h.views.some(v=>v.id===rename.id&&v.sheetId===h.sheetId&&v.canEdit))throw new Error('This view cannot be renamed');await h.onRename(rename.id,name,signal);}else await h.onSave(name,h.snapshot,signal);store.setState({name:'',renameId:null});})}/>
 {rename?<Button title="Cancel view rename" variant="secondary" unstyled={unstyled} onPress={()=>store.setState({name:'',renameId:null})}/>:null}
 <FlatList data={views.filter(v=>v.sheetId===sheetId)} keyExtractor={v=>v.id} initialNumToRender={6} windowSize={5} style={{height:360}} extraData={[off,activeId]} renderItem={({item})=><View style={{gap:6,paddingVertical:8}}><Button title={item.name+' · '+item.visibility} accessibilityState={{selected:item.id===activeId}} disabled={off} unstyled={unstyled} onPress={()=>guard.run('restore',(h,s)=>h.views.some(v=>v.id===item.id&&v.sheetId===h.sheetId)?h.onRestore(item.id,s):undefined)}/><Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.summary}</Text><View style={{flexDirection:'row',gap:6}}><Button title="Rename view" disabled={off||!item.canEdit} unstyled={unstyled} onPress={()=>store.setState({renameId:item.id,name:item.name})}/><Button title="Delete view" variant="danger" disabled={off||!item.canEdit} unstyled={unstyled} onPress={()=>store.setState({discardId:item.id})}/></View></View>}/>
 {discard?<View style={{gap:6}}><Text {...{className:unstyled?undefined:'text-text'}}>Delete saved view {discard.name}? Sheet data is unaffected.</Text><Button title="Confirm delete saved view" variant="danger" disabled={off} unstyled={unstyled} onPress={()=>guard.run('delete',async(h,s)=>{if(!h.views.some(v=>v.id===discard.id&&v.sheetId===h.sheetId&&v.canEdit))throw new Error('This view cannot be deleted');await h.onDelete(discard.id,s);store.setState({discardId:null});})}/><Button title="Keep saved view" variant="secondary" unstyled={unstyled} onPress={()=>store.setState({discardId:null})}/></View>:null}<ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/></View>;
}
function makeStore(){return createStore(()=>({name:'',renameId:null as string|null,discardId:null as string|null}));}
