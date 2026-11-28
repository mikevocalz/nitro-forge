import {useRef} from 'react';
import {FlatList,Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface LicensedSoundEffect {id:string;label:string;category:string;durationSeconds:number;licenseLabel:string;attribution?:string;insertAllowed:boolean;unavailableReason?:string}
export interface SoundEffectsLibraryProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sounds:readonly LicensedSoundEffect[];status:'loading'|'ready'|'error';error?:string;previewingId:string|null;
 onPreview:(id:string,signal?:AbortSignal)=>unknown;onStopPreview:()=>void;onInsert:(id:string,signal?:AbortSignal)=>unknown;onRetry:()=>void;unstyled?:boolean;
}
/** Searches admitted sound metadata. The host resolves media and records required attribution on insertion. */
export function SoundEffectsLibrary({scope='sound-effects',revision=0,...props}:SoundEffectsLibraryProps){
 const {sounds,status,error,previewingId,onPreview:_preview,onStopPreview,onInsert:_insert,onRetry,unstyled=false,disabledReason,style,...rest}=props;
 if(sounds.length>50000||new Set(sounds.map(s=>s.id)).size!==sounds.length||sounds.some(s=>!s.id.trim()||s.id.length>512||!s.label.trim()||s.label.length>1024||!s.category.trim()||s.category.length>256||!Number.isFinite(s.durationSeconds)||s.durationSeconds<0||!s.licenseLabel.trim()||s.licenseLabel.length>2048||s.attribution!==undefined&&s.attribution.length>8192)||!['loading','ready','error'].includes(status))throw new RangeError('Invalid sound effects catalog');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||status!=='ready'),off=guard.pending||disabledReason!==undefined||status!=='ready';
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,{query,category}=useStore(store,s=>s),q=query.trim().toLocaleLowerCase(),categories=[...new Set(sounds.map(s=>s.category))].slice(0,128),shown=sounds.filter(s=>(!category||s.category===category)&&(!q||s.label.toLocaleLowerCase().includes(q)));
 return <View {...rest} accessibilityLabel="Sound effects library" style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]}>
  <TextInput accessibilityLabel="Search sound effects" value={query} maxLength={256} onChangeText={query=>store.setState({query})} style={{minHeight:tokens.spacing.fixedTarget,padding:tokens.spacing.fixedElement}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.off6}}><Button title="All categories" variant="secondary" accessibilityState={{selected:category===null}} unstyled={unstyled} onPress={()=>store.setState({category:null})}/>{categories.map(c=><Button key={c} title={c} variant="secondary" accessibilityState={{selected:category===c}} unstyled={unstyled} onPress={()=>store.setState({category:c})}/>)}</View>
  <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{status==='loading'?'Loading sound effects':`${shown.length} matching sounds`}</Text>
  <FlatList data={status==='ready'?shown:[]} keyExtractor={s=>s.id} style={{height:controlTokens.extent.listTall}} initialNumToRender={6} windowSize={5} extraData={[off,previewingId]} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>No sound effects available in this view</Text>} renderItem={({item})=><View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.fixedElement}}>
   <Text {...{className:unstyled?undefined:'text-text'}}>{item.label} · {item.durationSeconds.toFixed(2)} s · {item.licenseLabel}</Text>{item.attribution?<Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.attribution}</Text>:null}
   <View style={{flexDirection:'row',gap:tokens.spacing.off6,flexWrap:'wrap'}}><Button title={'Preview '+item.label} disabled={off} unstyled={unstyled} onPress={()=>guard.run('preview',(h,s)=>h.sounds.some(v=>v.id===item.id)?h.onPreview(item.id,s):undefined)}/><Button title={'Insert '+item.label} disabled={off||!item.insertAllowed||item.unavailableReason!==undefined} accessibilityHint={item.unavailableReason??(!item.insertAllowed?'Sound is not licensed for insertion':undefined)} unstyled={unstyled} onPress={()=>guard.run('insert',(h,s)=>{const current=h.sounds.find(v=>v.id===item.id);return current?.insertAllowed&&current.unavailableReason===undefined?h.onInsert(item.id,s):undefined;})}/></View>
  </View>}/>
  {previewingId!==null||guard.pendingId==='preview'?<Button title="Stop sound preview" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onStopPreview();}}/>:null}
  {status==='error'?<Button title="Retry sound library" unstyled={unstyled} onPress={onRetry}/>:null}
  <ErrorMessage {...exact({message:guard.error??error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
function makeStore(){return createStore(()=>({query:'',category:null as string|null}));}
