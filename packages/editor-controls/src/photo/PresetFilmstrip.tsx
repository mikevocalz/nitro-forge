import {useLayoutEffect,useRef,type ComponentRef,type ReactNode} from 'react';
import {FlatList,I18nManager,Pressable,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {nodeIsRTL,shellKey} from '@nyc-tron/ui/components/shell/shell-keys';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {validatePresets} from '@nyc-tron/ui/components/shell/preset-model';
import {validatePhotoTargets} from './photo-presets.ts';
export interface FilmstripPreset {readonly id:string;readonly name:string;readonly preview:ReactNode;readonly favorite:boolean}
export interface PresetFilmstripProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly presets:readonly FilmstripPreset[];readonly selectedId:string|null;readonly photoIds:readonly string[];
 readonly onSelect:(id:string)=>void;readonly onPreview:(id:string|undefined)=>void;readonly onFavoriteChange:(id:string,favorite:boolean)=>void;
 readonly onApply:(presetId:string,photoIds:readonly string[],signal:AbortSignal)=>void|Promise<void>;
 readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Horizontal photo preset previews with explicit cancellable apply to the selected photo set. */
export function PresetFilmstrip({scope,presets,selectedId,photoIds,onSelect,onPreview,onFavoriteChange,onApply,disabled=false,unstyled=false,...props}:PresetFilmstripProps){
 validatePresets(presets);validatePhotoTargets(photoIds);if(presets.length>2000||!scope.trim())throw new RangeError('Invalid photo filmstrip scope or size');
 const action=useOwnedAction(scope),locked=disabled||action.pending!==null;
 const refs=useRef(new Map<string,ComponentRef<typeof Pressable>|null>());
 // Bind cleanup to the scope owner; callback identity changes must not cancel every preview render.
 useLayoutEffect(()=>()=>onPreview(undefined),[scope]);
 const key=(index:number,event:unknown)=>{if(locked)return;const k=shellKey(event);if(k.altKey||k.ctrlKey||k.metaKey)return;const rtl=nodeIsRTL(k.target)||I18nManager.isRTL;const next=k.key==='Home'?0:k.key==='End'?presets.length-1:k.key==='ArrowRight'?index+(rtl?-1:1):k.key==='ArrowLeft'?index+(rtl?1:-1):null;if(next===null)return;k.preventDefault();const target=presets[Math.max(0,Math.min(presets.length-1,next))];if(target)refs.current.get(target.id)?.focus();};
 const selected=presets.some(p=>p.id===selectedId);
 return <View {...props} style={[{gap:8},props.style]}>
  <FlatList horizontal data={presets} keyExtractor={preset=>preset.id} initialNumToRender={8} windowSize={5} style={{height:156}} accessibilityLabel="Photo preset filmstrip" extraData={[selectedId,locked]}
   ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No photo presets</Text>}
   renderItem={({item,index})=><View style={{width:144,padding:4,gap:4}}>
    <Pressable ref={ref=>{if(ref)refs.current.set(item.id,ref);else refs.current.delete(item.id);}} accessibilityRole="radio" accessibilityLabel={`Preview ${item.name}`} accessibilityState={{checked:item.id===selectedId,disabled:locked}} aria-checked={item.id===selectedId} disabled={locked}
     onPress={()=>{if(!locked){onSelect(item.id);onPreview(item.id);}}} onHoverIn={()=>{if(!locked)onPreview(item.id);}} onHoverOut={()=>onPreview(undefined)} onFocus={()=>{if(!locked)onPreview(item.id);}} onBlur={()=>onPreview(undefined)} {...{onKeyDown:(event:unknown)=>key(index,event)}} style={{minHeight:96,gap:4}}>
     <View pointerEvents="none" style={{height:64,overflow:'hidden'}}>{item.preview}</View><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{item.name}</Text>
    </Pressable>
    <Button title={item.favorite?'Unfavorite':'Favorite'} accessibilityLabel={`${item.favorite?'Unfavorite':'Favorite'} ${item.name}`} disabled={locked} unstyled={unstyled} onPress={()=>{if(!locked)onFavoriteChange(item.id,!item.favorite);}}/>
   </View>}/>
  <Button title="Cancel preset preview" unstyled={unstyled} onPress={()=>onPreview(undefined)}/>
  <Button title={`Apply preset to ${photoIds.length} photos`} disabled={locked||!selected||photoIds.length===0} unstyled={unstyled} onPress={()=>{if(!locked&&selected&&selectedId!==null&&photoIds.length)void action.run('apply',signal=>onApply(selectedId,[...photoIds],signal));}}/>
  {action.pending!==null?<Button title="Cancel preset application" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
