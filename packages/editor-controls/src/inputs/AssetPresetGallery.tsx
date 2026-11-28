import type {ReactNode} from 'react';
import {useRef} from 'react';
import {FlatList,Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from './useScopedControl.ts';
export interface AssetPreset {id:string;label:string;description:string;tags:readonly string[];favorite:boolean;unavailableReason?:string}
export interface AssetPresetGalleryProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 label:string;items:readonly AssetPreset[];selectedIds:readonly string[];renderPreview:(id:string)=>ReactNode;
 onApply:(id:string,signal?:AbortSignal)=>unknown;onFavorite?:(id:string,favorite:boolean,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** One virtual gallery owner for source-backed presets; all previews and saved metadata are host supplied. */
export function AssetPresetGallery({scope='asset-presets',revision=0,...props}:AssetPresetGalleryProps){
 const {label,items,selectedIds,renderPreview,onApply:_apply,onFavorite,unstyled=false,disabledReason,style,...rest}=props;
 if(!label.trim()||label.length>1024||items.length>10000||new Set(items.map(i=>i.id)).size!==items.length||items.some(i=>!i.id.trim()||i.id.length>256||!i.label.trim()||i.label.length>1024||i.description.length>8192||i.tags.length>64||i.tags.some(t=>t.length>256)))throw new RangeError('Invalid preset catalog');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),q=s.query.trim().toLocaleLowerCase(),shown=items.filter(i=>(!s.favorites||i.favorite)&&(!q||(i.label+' '+i.description+' '+i.tags.join(' ')).toLocaleLowerCase().includes(q)));
 return <View {...rest} accessibilityLabel={label} style={[{gap:8,minWidth:0},style]}><TextInput accessibilityLabel={'Search '+label} value={s.query} maxLength={256} onChangeText={query=>store.setState({query})} style={{minHeight:44,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/><Button title={s.favorites?'Show all presets':'Show favorite presets'} variant="secondary" unstyled={unstyled} onPress={()=>store.setState({favorites:!s.favorites})}/>
 <FlatList data={shown} keyExtractor={i=>i.id} style={{height:380}} initialNumToRender={5} windowSize={5} extraData={[off,selectedIds]} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>No matching presets supplied</Text>} renderItem={({item})=><View style={{gap:6,paddingVertical:8}}>{renderPreview(item.id)}<Button title={item.label} accessibilityState={{selected:selectedIds.includes(item.id)}} disabled={off||item.unavailableReason!==undefined} accessibilityHint={item.unavailableReason} unstyled={unstyled} onPress={()=>guard.run('apply',(h,s)=>h.items.some(v=>v.id===item.id&&v.unavailableReason===undefined)?h.onApply(item.id,s):undefined)}/><Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.description}</Text>{item.unavailableReason?<Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.unavailableReason}</Text>:null}{onFavorite?<Button title={item.favorite?'Remove favorite':'Add favorite'} variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.run('favorite',(h,s)=>{const i=h.items.find(v=>v.id===item.id);return i?h.onFavorite?.(i.id,!i.favorite,s):undefined;})}/>:null}</View>}/><ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/></View>;
}
function makeStore(){return createStore(()=>({query:'',favorites:false}));}
