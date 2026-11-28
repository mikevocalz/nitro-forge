import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {PresetFilmstrip} from '@nitro-forge/editor-controls/photo/PresetFilmstrip';
import {PresetManager} from '@nitro-forge/editor-controls/photo/PresetManager';
import {PhotoVersionHistoryBrowser} from '@nitro-forge/editor-controls/photo/PhotoVersionHistoryBrowser';
import {BatchExportPanel} from '@nitro-forge/editor-controls/photo/BatchExportPanel';
import {defaultPhotoDevelop} from '@nitro-forge/editor-controls/photo/photo-adjustments';
import {serializePhotoPreset,type PhotoPreset} from '@nitro-forge/editor-controls/photo/photo-presets';
import {defaultPhotoBatchExport,type PhotoBatchExportSettings} from '@nitro-forge/editor-controls/photo/photo-export';
const warm:PhotoPreset={version:1,id:'warm',name:'Warm',settings:{...defaultPhotoDevelop(),exposure:{...defaultPhotoDevelop().exposure,temperature:7200}}};
const imported:PhotoPreset={...warm,id:'imported',name:'Imported warmth'};
const versions=[{id:'original',name:'Original RAW settings',timestampMs:1793988000000,settings:defaultPhotoDevelop()},{id:'graded',name:'Graded print version',timestampMs:1793988600000,settings:warm.settings}];
const formats=[{id:'jpeg',label:'JPEG',supportsQuality:true},{id:'png',label:'PNG',supportsQuality:false}];
const makeStore=()=>createStore(()=>({section:'Filmstrip' as 'Filmstrip'|'Manager'|'Versions'|'Export',revision:0,presets:[warm] as readonly PhotoPreset[],selected:'warm' as string|null,preview:null as string|null,favorites:[] as readonly string[],applied:null as {id:string;ids:readonly string[]}|null,exportedPreset:'',currentVersion:'graded',selectedVersion:'original',compared:null as string|null,exportSettings:defaultPhotoBatchExport('jpeg'),exportRequest:null as {ids:readonly string[];settings:PhotoBatchExportSettings}|null}));
/** Captures typed requests only; this fixture does not encode images or write external files. */
export function PhotoWorkflowDemo({invalid=false,deferred=false}:{readonly invalid?:boolean;readonly deferred?:boolean}){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 const transfer=useRef<(()=>void)|null>(null);
 return <View style={{padding:16,gap:12,maxWidth:700,width:'100%',flex:1}}>
  <TabBar tabs={(['Filmstrip','Manager','Versions','Export'] as const).map(key=>({key,label:key,active:s.section===key,onPress:()=>store.setState({section:key})}))}/>
  {deferred?<Button title="Finish preset import" onPress={()=>transfer.current?.()}/>:null}
  {s.section==='Filmstrip'?<PresetFilmstrip scope={`photo-set:${s.revision}`} presets={s.presets.map(p=>({id:p.id,name:p.name,preview:<Text {...{className:'text-text'}}>Provider preview not loaded</Text>,favorite:s.favorites.includes(p.id)}))} selectedId={s.selected} photoIds={['a','b']} onSelect={selected=>store.setState({selected})} onPreview={preview=>store.setState({preview:preview??null})} onFavoriteChange={(id,favorite)=>store.setState(s=>({favorites:favorite?[...s.favorites,id]:s.favorites.filter(value=>value!==id)}))} onApply={(id,ids)=>{store.setState({applied:{id,ids}});}}/>:null}
  {s.section==='Manager'?<ScrollView><PresetManager scope={`library:${s.revision}`} presets={s.presets} selectedId={s.selected} onSelect={selected=>store.setState({selected})} onRename={(id,name)=>{store.setState(s=>({revision:s.revision+1,presets:s.presets.map(p=>p.id===id?{...p,name}:p)}));}} onDelete={id=>{store.setState(s=>({revision:s.revision+1,presets:s.presets.filter(p=>p.id!==id),selected:null}));}} onReadImport={()=>{const text=invalid?'{}':serializePhotoPreset(imported);return deferred?new Promise<string>(resolve=>{transfer.current=()=>resolve(text);}):text;}} onImport={preset=>{store.setState(s=>({revision:s.revision+1,presets:[...s.presets,preset],selected:preset.id}));}} onExport={exportedPreset=>{store.setState({exportedPreset});}}/></ScrollView>:null}
  {s.section==='Versions'?<PhotoVersionHistoryBrowser photoId="a" revision={String(s.revision)} versions={versions} originalVersionId="original" selectedId={s.selectedVersion} currentId={s.currentVersion} onSelect={selectedVersion=>store.setState({selectedVersion})} onCompare={version=>store.setState({compared:version?.id??null})} onRestore={version=>{store.setState(s=>({revision:s.revision+1,currentVersion:version.id}));}}/>:null}
  {s.section==='Export'?<ScrollView><BatchExportPanel scope={`export:${s.revision}`} photoIds={['a','b']} value={s.exportSettings} formats={formats} onChange={exportSettings=>store.setState({exportSettings})} onExport={(ids,settings)=>{store.setState({exportRequest:{ids,settings}});}}/></ScrollView>:null}
  <Text {...{className:'text-text'}} numberOfLines={3} testID="workflow-state" accessibilityLabel={`Photo workflow state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;
}
