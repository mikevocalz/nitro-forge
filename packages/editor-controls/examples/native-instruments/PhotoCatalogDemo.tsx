import {useRef} from 'react';
import {ScrollView,View,Text} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {PhotoLibraryGrid} from '@nitro-forge/editor-controls/photo/PhotoLibraryGrid';
import {CatalogFilterBar} from '@nitro-forge/editor-controls/photo/CatalogFilterBar';
import {PhotoMetadataInspector} from '@nitro-forge/editor-controls/photo/PhotoMetadataInspector';
import {BeforeAfterCompare} from '@nitro-forge/editor-controls/photo/BeforeAfterCompare';
import {emptyPhotoCatalogFilter,type PhotoCatalogItem} from '@nitro-forge/editor-controls/photo/photo-catalog';
import type {CompareMode} from '@nitro-forge/editor-controls/photo/BeforeAfterCompare';
const makeStore=()=>createStore(()=>({filters:emptyPhotoCatalogFilter(),selected:['off-page'] as readonly string[],opened:'',mode:'side-by-side' as CompareMode,split:.5,overlay:.5,changes:0,annotation:'Original edit note',metadataRevision:0,annotationCommits:0,section:'Filters' as 'Filters'|'Library'|'Compare'|'Metadata'}));
const choices=[{id:'camera-1',label:'Harbor camera'}];
const photos:readonly PhotoCatalogItem[]=Array.from({length:10000},(_,i)=>({id:`photo-${i}`,name:`Catalog photo ${i}`,thumbnailUri:null,rating:{stars:0,label:'none',flag:'none'}}));
const source={kind:'pixels' as const,raster:{width:2,height:2,pixels:new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])}};
/** Generated catalog records and test raster; neither represents a RAW engine or thumbnail provider. */
export function PhotoCatalogDemo(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 return <View style={{padding:16,gap:12,maxWidth:700,width:'100%',flex:1}}>
  <TabBar tabs={(['Filters','Library','Compare','Metadata'] as const).map(key=>({key,label:key,active:s.section===key,onPress:()=>store.setState({section:key})}))}/>
  <Text {...{className:'text-text'}}>Catalog UI consumer: 10,000 generated records; thumbnails unavailable</Text>
  {s.section==='Filters'?<ScrollView style={{maxHeight:480}}><CatalogFilterBar catalogId="demo" value={s.filters} cameras={choices} lenses={[{id:'lens-1',label:'50 mm lens'}]} albums={[{id:'album-1',label:'Harbor album'}]} onChange={filters=>store.setState(s=>({filters,changes:s.changes+1}))}/></ScrollView>:null}
  {s.section==='Library'?<PhotoLibraryGrid photos={photos} selectedIds={s.selected} onSelectionChange={selected=>store.setState({selected})} onOpen={opened=>store.setState({opened})} height={300}/>:null}
  {s.section==='Compare'?<View style={{height:300}}><BeforeAfterCompare before={source} after={source} mode={s.mode} onModeChange={mode=>store.setState({mode})} split={s.split} onSplitCommit={split=>store.setState({split})} overlayOpacity={s.overlay} onOverlayOpacityCommit={overlay=>store.setState({overlay})}/></View>:null}
  {s.section==='Metadata'?<ScrollView style={{maxHeight:480}}><PhotoMetadataInspector value={{photoId:'photo-0',revision:s.metadataRevision,fileName:'Harbor.dng',mimeType:'image/x-adobe-dng',dimensions:{width:6000,height:4000},cameraMaker:'Test maker',cameraModel:'Test body',lens:null,capturedAt:'2026:11:06 09:10:00-05:00',exposureSeconds:1/125,aperture:2.8,iso:100,focalLengthMm:50,provenance:[{id:'import',label:'Source',value:'Original imported file retained'}]}} annotation={s.annotation} onAnnotationCommit={annotation=>store.setState(s=>({annotation,metadataRevision:s.metadataRevision+1,annotationCommits:s.annotationCommits+1}))}/></ScrollView>:null}
  <Text {...{className:'text-text'}} numberOfLines={3} testID="catalog-state" accessibilityLabel={`Catalog consumer state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;
}
