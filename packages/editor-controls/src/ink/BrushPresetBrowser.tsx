import {useRef,type ReactNode} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {joinClasses} from '@nyc-tron/ui/components/styles';
export interface BrushPreset {id:string;name:string;category:string;favorite:boolean;disabledReason?:string}
export interface BrushPresetBrowserProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 presets:readonly BrushPreset[];selectedId?:string;onSelect:(id:string,signal?:AbortSignal)=>void|Promise<unknown>;
 onFavorite:(id:string,favorite:boolean,signal?:AbortSignal)=>void|Promise<unknown>;
 /** The host renders the preset's actual stroke thumbnail. */
 renderPreview:(preset:BrushPreset)=>ReactNode;unstyled?:boolean;
}
export function BrushPresetBrowser({scope='brush-presets',revision=0,...props}:BrushPresetBrowserProps){
 const {presets,selectedId,onSelect:_select,onFavorite:_favorite,renderPreview,unstyled=false,disabledReason,style,...rest}=props;
 if(presets.length>10000||new Set(presets.map(p=>p.id)).size!==presets.length||presets.some(p=>!p.id.trim()||p.id.length>512||!p.name.trim()||p.name.length>1024||p.category.length>512))throw new RangeError('Invalid brush catalog');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v);
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const query=s.query.trim().toLocaleLowerCase(),items=presets.filter(p=>(!s.favorites||p.favorite)&&(!query||[p.name,p.category].some(t=>t.toLocaleLowerCase().includes(query))));
 return <View {...rest} style={[{minHeight:240,minWidth:0,gap:8},style]} accessibilityLabel="Brush presets">
  <TextInput accessibilityLabel="Search brushes" maxLength={128} value={s.query} onChangeText={query=>store.setState({query})} style={{minHeight:44,padding:8}} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control')}}/>
  <Button title={s.favorites?'Show all brushes':'Show favorite brushes'} variant="secondary" unstyled={unstyled} onPress={()=>store.setState({favorites:!s.favorites})}/>
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{items.length} brushes</Text>
  <FlatList data={items} keyExtractor={p=>p.id} keyboardShouldPersistTaps="handled" style={{maxHeight:480}} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>No matching brushes</Text>} renderItem={({item})=><View style={{gap:4,paddingVertical:8}}>
   <View accessible accessibilityRole="image" accessibilityLabel={item.name+' stroke preview'}>{renderPreview(item)}</View>
   <Button title={item.name} accessibilityState={{selected:item.id===selectedId}} disabled={off||item.disabledReason!==undefined} accessibilityHint={item.disabledReason} unstyled={unstyled} onPress={()=>guard.run('select',(host,signal)=>{const preset=host.presets.find(p=>p.id===item.id);return preset&&preset.disabledReason===undefined?host.onSelect(item.id,signal):undefined;})}/>
   <Text {...{className:unstyled?undefined:'text-text'}}>{item.category}</Text>
   <Button title={(item.favorite?'Unfavorite ':'Favorite ')+item.name} variant="ghost" disabled={off} unstyled={unstyled} onPress={()=>guard.run('favorite',(host,signal)=>{const p=host.presets.find(p=>p.id===item.id);return p?host.onFavorite(p.id,!p.favorite,signal):undefined;})}/>
  </View>}/>
  {off?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Updating brush'}</Text>:null}<ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
function makeStore(){return createStore(()=>({query:'',favorites:false}));}
