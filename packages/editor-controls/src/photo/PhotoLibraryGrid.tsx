import {useMemo,useRef} from 'react';
import {FlatList,Image,Pressable,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {togglePhotoSelection,validatePhotoCatalog,type PhotoCatalogItem} from './photo-catalog.ts';
import { tokens } from '../tokens.ts';
export type {PhotoCatalogItem} from './photo-catalog.ts';
export interface PhotoLibraryGridProps extends Omit<ViewProps,'children'> {
 readonly photos:readonly PhotoCatalogItem[];readonly selectedIds:readonly string[];
 readonly onSelectionChange:(ids:readonly string[])=>void;readonly onOpen:(id:string)=>void;
 readonly height?:number;readonly minimumTileWidth?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
 readonly loading?:boolean;readonly onLoadMore?:()=>void;
}
/** Virtualized catalog page with host-generated thumbnails; originals are never decoded by the grid. */
export function PhotoLibraryGrid({photos,selectedIds,onSelectionChange,onOpen,height=480,minimumTileWidth=144,disabled=false,unstyled=false,loading=false,onLoadMore,...props}:PhotoLibraryGridProps){
 useMemo(()=>validatePhotoCatalog(photos,selectedIds),[photos,selectedIds]);
 if(!Number.isFinite(height)||height<160||height>4000||!Number.isFinite(minimumTileWidth)||minimumTileWidth<100||minimumTileWidth>500)throw new RangeError('Invalid photo grid bounds');
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,width=useStore(store,s=>s.width);
 const columns=Math.max(1,Math.min(12,Math.floor(width/minimumTileWidth)));
 const selected=useMemo(()=>new Set(selectedIds),[selectedIds]);
 return <View {...props} onLayout={event=>{const width=event.nativeEvent.layout.width;if(Number.isFinite(width))store.setState({width});props.onLayout?.(event);}} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text')}}>{`${photos.length} photos on this page; ${selectedIds.length} selected${loading?'; loading':''}`}</Text>
  <FlatList key={columns} data={photos} keyExtractor={photo=>photo.id} numColumns={columns} initialNumToRender={18} maxToRenderPerBatch={12} windowSize={5} style={{height}} accessibilityLabel="Photo library" extraData={selectedIds}
   onEndReached={()=>{if(!loading&&!disabled)onLoadMore?.();}} onEndReachedThreshold={.5}
   ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{loading?'Loading photos…':'No photos match this catalog view.'}</Text>}
   renderItem={({item})=><View style={{width:`${100/columns}%`,padding:tokens.spacing.fixedStack,gap:tokens.spacing.fixedStack}}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.name}`} accessibilityState={{checked:selected.has(item.id),disabled}} aria-checked={selected.has(item.id)} disabled={disabled} onPress={()=>onSelectionChange(togglePhotoSelection(selectedIds,item.id))} style={{minHeight:tokens.spacing.off96,borderWidth:selected.has(item.id)?tokens.borderWidth.strong:tokens.borderWidth.hairline,padding:tokens.spacing.fixedStack,gap:tokens.spacing.fixedStack}} {...{className:joinClasses(!unstyled&&'border-border rounded-control')}}>
     {item.thumbnailUri?<Image source={{uri:item.thumbnailUri}} resizeMode="cover" accessible={false} style={{width:'100%',aspectRatio:1}}/>:<View style={{width:'100%',aspectRatio:1,justifyContent:'center'}}><Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Thumbnail unavailable</Text></View>}
     <Text numberOfLines={2} {...{className:joinClasses(!unstyled&&'text-text')}}>{item.name}</Text>
     <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{`${item.rating.stars} stars · ${item.rating.label} · ${item.rating.flag}`}</Text>
    </Pressable>
    <Button title="Open photo" accessibilityLabel={`Open ${item.name}`} disabled={disabled} unstyled={unstyled} onPress={()=>onOpen(item.id)}/>
   </View>}/>
 </View>;
}
const makeStore=()=>createStore(()=>({width:0}));
