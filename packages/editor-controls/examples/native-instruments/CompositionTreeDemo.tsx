import {useRef} from 'react';
import {Platform,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {CompositionLayerTree,type CompositionLayer} from '@nitro-forge/editor-controls/motion/CompositionLayerTree';
const layer=(id:string,name:string,kind:CompositionLayer['kind'],parentId:string|null=null,compositionId:string|null=null):CompositionLayer=>({id,name,kind,parentId,compositionId,visible:true,locked:false,opacity:1});
const initial=():readonly CompositionLayer[]=>[layer('nested','Title composition','composition',null,'title'),layer('text','Title text','text','nested'),layer('shape','Backdrop shape','shape','nested'),layer('footage','Source footage','footage'),layer('grade','Grade adjustment','adjustment')];
const makeStore=()=>createStore(()=>({scope:'main',revision:0,layers:initial(),expanded:[] as readonly string[],selected:'text' as string|null,commits:0,reject:false,height:0}));
export function CompositionTreeDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v);return <View style={{flex:1,padding:16,gap:8}} onLayout={event=>{const height=event.nativeEvent.layout.height;if(height!==store.getState().height)store.setState({height});}}>
 {Platform.OS==='web'?<View style={{gap:8}}>
 <Button title="Switch composition tree document" onPress={()=>store.setState(s=>({scope:s.scope==='main'?'other':'main',revision:0,layers:initial(),expanded:[],selected:'text',commits:0}))}/>
 <Button title={s.reject?'Allow visibility changes':'Reject visibility changes'} onPress={()=>store.setState({reject:!s.reject})}/>
 </View>:null}
 <CompositionLayerTree scope={s.scope} revision={s.revision} compositionId={s.scope} layers={s.layers} expandedIds={s.expanded} selectedId={s.selected} onExpandedChange={expanded=>store.setState({expanded})} onSelect={selected=>store.setState({selected})} onVisibilityChange={async(id,visible,signal)=>{await new Promise(resolve=>setTimeout(resolve,30));if(signal.aborted)return;if(store.getState().reject)throw new Error('Layer visibility is read-only');store.setState(s=>({layers:s.layers.map(layer=>layer.id===id?{...layer,visible}:layer),commits:s.commits+1}));}} height={Platform.OS==='web'?276:Math.max(100,Math.min(276,s.height-200))}/>
 <Text {...{className:'text-text'}} testID="composition-tree-state" numberOfLines={3} accessibilityLabel={`Composition tree state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;}
